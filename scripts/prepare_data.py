"""Reproducible Excel -> local 3D observations. Never writes to input workbooks."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import openpyxl
import pyproj
import rasterio
from pyproj import CRS
from pyproj.aoi import AreaOfInterest
from pyproj.transformer import TransformerGroup

ROOT = Path(__file__).resolve().parents[1]
TILE = 'Copernicus_DSM_COG_10_N29_00_E091_00_DEM'
URL = f'https://copernicus-dem-30m.s3.amazonaws.com/{TILE}/{TILE}.tif'
LICENSE = '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. This product has been modified.'


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def number(value):
    return float(value) if isinstance(value, (float, int)) and math.isfinite(value) else None


def valid_height(value):
    # Project-specific screening range, not a correction or a universal terrain limit.
    return number(value) is not None and 3500 < value < 6500


def bilinear(array, transform, east, north, nodata=None):
    """Coordinates refer to pixel centres; require all 4 valid neighbours."""
    col, row = (~transform) * (np.asarray(east), np.asarray(north))
    col, row = col - .5, row - .5
    finite = np.isfinite(col) & np.isfinite(row)
    i = np.floor(np.where(finite, col, -1)).astype(int)
    j = np.floor(np.where(finite, row, -1)).astype(int)
    ok = finite & (i >= 0) & (j >= 0) & (i + 1 < array.shape[1]) & (j + 1 < array.shape[0])
    out = np.full(col.shape, np.nan)
    idx = np.where(ok)[0]
    if not len(idx):
        return out
    x, y = col[idx] - i[idx], row[idx] - j[idx]
    values = np.array([array[j[idx], i[idx]], array[j[idx], i[idx]+1], array[j[idx]+1, i[idx]], array[j[idx]+1, i[idx]+1]])
    good = np.all(np.isfinite(values), axis=0)
    if nodata is not None:
        good &= np.all(values != nodata, axis=0)
    z = values[0]*(1-x)*(1-y) + values[1]*x*(1-y) + values[2]*(1-x)*y + values[3]*x*y
    out[idx[good]] = z[good]
    return out


def transformation(code):
    return TransformerGroup(CRS.from_epsg(code), CRS.from_epsg(4326), always_xy=True,
                            area_of_interest=AreaOfInterest(91, 29, 92, 30)).transformers[0]


def metrics(residuals):
    d = np.asarray(residuals)
    d = d[np.isfinite(d)]
    return dict(n=len(d), median=float(np.median(d)), mae=float(np.mean(abs(d))),
                rmse=float(np.sqrt(np.mean(d*d))), p90=float(np.quantile(abs(d), .9)),
                within30=float(np.mean(abs(d) < 30))) if len(d) else dict(n=0)


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')


def rows(ws):
    return [list(r) for r in ws.values if any(v is not None for v in r)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true', help='Require existing cached DEM')
    args = parser.parse_args()
    output = ROOT / 'public' / 'dataset'
    output.mkdir(parents=True, exist_ok=True)
    reports = ROOT / 'reports'
    reports.mkdir(exist_ok=True)
    dem_path = ROOT / 'data' / 'dem' / f'{TILE}.tif'
    dem_path.parent.mkdir(exist_ok=True)
    if not dem_path.exists():
        if args.offline:
            raise SystemExit('DEM cache missing; first run without --offline.')
        print('Downloading public Copernicus DEM...', flush=True)
        request = urllib.request.Request(URL, headers={'User-Agent': 'GeoProspect/1.0 scientific-data-preparation'})
        with urllib.request.urlopen(request, timeout=120) as r, open(dem_path.with_suffix('.partial'), 'wb') as f:
            for chunk in iter(lambda: r.read(1024 * 1024), b''):
                f.write(chunk)
            metadata = dict(url=URL, etag=r.headers.get('ETag'), lastModified=r.headers.get('Last-Modified'), downloadedAt=datetime.now(timezone.utc).isoformat())
        dem_path.with_suffix('.partial').replace(dem_path)
        write_json(dem_path.with_suffix('.source.json'), metadata)
    source_meta = json.loads(dem_path.with_suffix('.source.json').read_text('utf-8')) if dem_path.with_suffix('.source.json').exists() else {'url': URL, 'downloadedAt': None}
    with rasterio.open(dem_path) as dem:
        array, affine, nodata = dem.read(1), dem.transform, dem.nodata
        raster_meta = dict(shape=list(array.shape), transform=list(affine)[:6], horizontalCRS=str(dem.crs), nodata=nodata)
    tx = transformation(4540)
    def heights(e, n, transformer=tx):
        lon, lat = transformer.transform(e, n)
        return bilinear(array, affine, lon, lat, nodata)

    surface_path = ROOT / 'data' / 'Jiama geochemistry data 2020.8.30-iogas.xlsx'
    drill_path = ROOT / 'data' / '数据库-川大 2025.4.29.xlsx'
    print('Reading original workbooks...', flush=True)
    sw = openpyxl.load_workbook(surface_path, read_only=True, data_only=True)
    dw = openpyxl.load_workbook(drill_path, read_only=True, data_only=True)
    sraw, aux, craw, draw = rows(sw['data']), rows(sw['Sheet3']), rows(dw['空间位置']), rows(dw['分析数据'])
    sh, ch, dh = sraw.pop(0), craw.pop(0), draw.pop(0)
    aux.pop(0)
    issues = []
    def issue(kind, source, row, identifier, detail):
        issues.append(dict(kind=kind, source=source, row=row, id=str(identifier), detail=detail))
    ids = Counter(str(r[0]) for r in sraw)
    for i, r in enumerate(sraw, 2):
        if ids[str(r[0])] > 1:
            issue('duplicate_sample_id', 'surface', i, r[0], 'Stable object IDs use source row; sample ID is duplicated.')
    main_by_id = {r[0]: r for r in sraw}
    matched_aux = 0
    for i, r in enumerate(aux, 2):
        primary = main_by_id.get(r[0])
        if primary is not None:
            matched_aux += 1
            if [primary[1], primary[2], primary[53]] != [r[1]-16000000, r[2], r[3]]:
                issue('aux_coordinate_conflict', 'Sheet3', i, r[0], f'Main E,N,H={primary[1],primary[2],primary[53]}; auxiliary={r[1]-16000000,r[2],r[3]}; main retained.')

    s_dem = heights(np.array([r[1] for r in sraw]), np.array([r[2] for r in sraw]))
    points, s_flags = [], []
    for index, r in enumerate(sraw):
        flags = []
        if valid_height(r[53]):
            z, source = r[53], 'original'
        else:
            reason = 'missing_height' if r[53] is None else 'suspect_height'
            z = float(s_dem[index]) if np.isfinite(s_dem[index]) else None
            source = 'dem' if z is not None else 'unlocated'
            flags.append(reason)
            if reason == 'suspect_height' or z is None:
                issue(reason if z is not None else 'unlocated', 'surface', index+2, r[0], f'Original H={r[53]}; display H={z}')
        points.append([r[1], r[2], z, source])
        s_flags.append(flags)

    collar_index, collars, c_flags = {}, [], []
    for index, r in enumerate(craw):
        if r[0] in collar_index:
            raise ValueError(f'Duplicate collar ID: {r[0]}')
        collar_index[r[0]] = index
        collars.append([r[1]-31000000, r[2], r[3]])
        c_flags.append([])
    groups, segments, d_flags = defaultdict(list), [], []
    for index, r in enumerate(draw):
        flags = []
        ci = collar_index.get(r[0])
        if ci is None or number(r[1]) is None or number(r[2]) is None or r[1] < 0 or r[2] <= r[1]:
            segments.append(None)
            flags.append('invalid_interval_or_collar')
        else:
            if number(r[3]) is None or abs(r[2]-r[1]-r[3]) > .02:
                flags.append('interval_length_mismatch')
            if r[2] > craw[ci][4] + .01:
                flags.append('beyond_total_depth')
            segments.append([ci, collars[ci][2]-r[1], collars[ci][2]-r[2]])
            groups[r[0]].append((r[1], r[2], index))
        for flag in flags:
            issue(flag, 'drill', index+2, r[4], f'HOLE={r[0]}, FROM={r[1]}, TO={r[2]}, INT={r[3]}')
        d_flags.append(flags)
    gaps = []
    for hole, entries in groups.items():
        end = None
        for start, stop, index in sorted(entries):
            if end is not None:
                if start < end - .001:
                    d_flags[index].append('overlapping_interval')
                    issue('overlapping_interval', 'drill', index+2, draw[index][4], f'{hole}: {start} < {end}')
                elif start > end + .001:
                    gaps.append(dict(hole=hole, start=end, end=start, nextRow=index+2))
            end = max(end or 0, stop)
    for hole, ci in collar_index.items():
        if hole not in groups:
            c_flags[ci].append('no_assay')
            issue('no_assay', 'collar', ci+2, hole, 'Collar only; no invented sample intervals.')

    # Element IDs include original chemical species; oxides never collapse to elements.
    chemistry = {}
    for source, header, first, last in [('surface', sh, 4, 53), ('drill', dh, 5, 11)]:
        for index in range(first, last):
            label = str(header[index]).strip()
            name, unit = label.rsplit(' ', 1)
            canonical_unit = '%' if source == 'surface' and unit == '%' else 'ppm'
            entry = chemistry.setdefault(name, dict(id=name, unit=canonical_unit, columns={}))
            entry['columns'][source] = dict(index=index, unit=unit, factor=10000 if unit == '%' and canonical_unit == 'ppm' else 1)
    for name, entry in chemistry.items():
        values = []
        for source, raw in [('surface', sraw), ('drill', draw)]:
            spec = entry['columns'].get(source)
            if spec:
                values.extend(number(r[spec['index']])*spec['factor'] for r in raw if number(r[spec['index']]) is not None)
        positive = [v for v in values if v > 0]
        entry['range'] = [min(values), max(values)] if values else [0, 1]
        entry['positiveRange'] = [min(positive), max(positive)] if positive else None

    comparisons = []
    known = np.array([[r[1], r[2], r[53]] for r in sraw if valid_height(r[53])])
    c_coords = np.array(collars)
    residual_rows = []
    for code in (4540, 2376, 2428, 32646):
        transformer = transformation(code)
        for group, coords in [('surface', known), ('collar', c_coords)]:
            z = heights(coords[:, 0], coords[:, 1], transformer)
            summary = metrics(coords[:, 2] - z)
            comparisons.append(dict(epsg=code, name=CRS.from_epsg(code).name, group=group,
                                     operation=transformer.description, accuracy=transformer.accuracy, **summary))
    for group, raw, coords in [('surface', sraw, points), ('collar', craw, collars)]:
        for i, (r, xyz) in enumerate(zip(raw, coords)):
            h = r[53] if group == 'surface' else r[3]
            if valid_height(h):
                z = float(s_dem[i]) if group == 'surface' else float(heights(np.array([xyz[0]]), np.array([xyz[1]]))[0])
                residual_rows.append([group, i+2, r[0], xyz[0], xyz[1], h, z, h-z])

    # Terrain is a display mesh, sampled from the original raster every 60 project metres.
    xy = np.array([[r[0], r[1]] for r in points] + [[r[0], r[1]] for r in collars])
    low, high = xy.min(axis=0)-200, xy.max(axis=0)+200
    east = np.arange(math.floor(low[0]/60)*60, high[0]+60, 60)
    north = np.arange(math.floor(low[1]/60)*60, high[1]+60, 60)
    ex, ny = np.meshgrid(east, north)
    terrain_z = heights(ex.ravel(), ny.ravel())
    terrain = dict(east=east.tolist(), north=north.tolist(), heights=[round(float(z), 2) if np.isfinite(z) else None for z in terrain_z], spacing=60)
    source_files = [dict(file=p.name, sha256=digest(p)) for p in (surface_path, drill_path)]
    pipeline_hash = digest(Path(__file__))
    version = hashlib.sha256(json.dumps([source_files, digest(dem_path), pipeline_hash]).encode()).hexdigest()[:16]
    counts = dict(surface=len(sraw), collars=len(craw), intervals=len(draw), originalHeight=sum(p[3]=='original' for p in points),
                  demHeight=sum(p[3]=='dem' for p in points), unlocated=sum(p[3]=='unlocated' for p in points), gaps=len(gaps), auxiliaryMatched=matched_aux,
                  issues=dict(Counter(i['kind'] for i in issues)))
    z_all = [p[2] for p in points if p[2] is not None] + [s[2] for s in segments if s]
    manifest = dict(schemaVersion=1, version=version, generatedAt=datetime.now(timezone.utc).isoformat(), counts=counts, sources=source_files,
                    pipelineSHA256=pipeline_hash, runtime=dict(python=sys.version.split()[0], numpy=np.__version__, rasterio=rasterio.__version__, pyproj=pyproj.__version__),
                    coordinate=dict(status='provisional', workingEPSG=4540, centralMeridian=93, originalDatum='unconfirmed', verticalDatum='unconfirmed',
                                    transform=tx.description, transformAccuracy=tx.accuracy, axis=['East','North','Height'], unit='m', boreholes='vertical_confirmed_by_user'),
                    origin=[round(float(xy[:,0].mean()),0), round(float(xy[:,1].mean()),0), 4000],
                    bounds=[float(xy[:,0].min()),float(xy[:,1].min()),float(min(z_all)),float(xy[:,0].max()),float(xy[:,1].max()),float(max(z_all))],
                    dem=dict(**source_meta, **raster_meta, sha256=digest(dem_path), tile=TILE, product='Copernicus GLO-30 Public COG', verticalCRS='EGM2008 (EPSG:3855)',
                             resolution='1 arc second (~30 m)', release='Not declared by mirror; identify exact bytes using SHA256 and ETag', citation='https://doi.org/10.5270/ESA-c5d3d65', license=LICENSE),
                    chemistry=list(chemistry.values()), comparisons=comparisons)
    data = dict(surface=dict(headers=sh, rows=sraw, geometry=points, flags=s_flags),
                collar=dict(headers=ch, rows=craw, geometry=collars, flags=c_flags),
                drill=dict(headers=dh, rows=draw, geometry=segments, flags=d_flags), terrain=terrain)
    with gzip.GzipFile(filename=str(output/'observations.json.gz'), mode='wb', mtime=0) as f:
        f.write(json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8'))
    write_json(output/'manifest.json', manifest)
    quality = dict(counts=counts, issues=issues, gaps=gaps, comparisons=comparisons)
    write_json(output/'quality.json', quality)
    write_json(reports/'quality.json', quality)
    with open(reports/'dem_residuals.csv','w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f); writer.writerow(['source','row','id','east','north','original_height','dem_height','original_minus_dem']);writer.writerows(residual_rows)
    print(json.dumps(counts,ensure_ascii=False,indent=2))
    print(f'Prepared version {version}; compressed data {(output/"observations.json.gz").stat().st_size/1e6:.2f} MB')


if __name__ == '__main__':
    main()
