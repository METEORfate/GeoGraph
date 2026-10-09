import gzip
import hashlib
import json
import unittest
from pathlib import Path
import sys

import numpy as np
import rasterio
from affine import Affine

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from prepare_data import bilinear, valid_height


class GeometryAndDEM(unittest.TestCase):
    def test_bilinear_centres_and_edges(self):
        raster = np.array([[10., 20.], [30., 40.]])
        tx = Affine(1, 0, 0, 0, -1, 2)
        z = bilinear(raster, tx, np.array([.5, 1., 0., 2., np.nan]), np.array([1.5, 1., 1., 1., 1.]))
        np.testing.assert_allclose(z[:2], [10, 25])
        self.assertTrue(np.isnan(z[2:]).all())

    def test_nodata_not_zero_fill(self):
        raster = np.array([[10., 20.], [-9999., 40.]])
        z = bilinear(raster, Affine.identity(), np.array([1.]), np.array([1.]), -9999)
        self.assertTrue(np.isnan(z[0]))
        self.assertFalse(valid_height(.26))
        self.assertTrue(valid_height(4882))


class PreparedData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT/'public/dataset/manifest.json').read_text('utf-8'))
        cls.quality = json.loads((ROOT/'reports/quality.json').read_text('utf-8'))
        with gzip.open(ROOT/'public/dataset/observations.json.gz','rt',encoding='utf-8') as f:
            cls.data=json.load(f)

    def test_original_files_unchanged(self):
        for source in self.manifest['sources']:
            self.assertEqual(hashlib.sha256((ROOT/'data'/source['file']).read_bytes()).hexdigest(),source['sha256'])

    def test_counts_and_quality(self):
        self.assertEqual(len(self.data['surface']['rows']),9021)
        self.assertEqual(len(self.data['collar']['rows']),477)
        self.assertEqual(len(self.data['drill']['rows']),114082)
        self.assertEqual(self.manifest['counts']['originalHeight'],1963)
        self.assertEqual(self.manifest['counts']['demHeight'],7058)
        self.assertEqual(len(self.quality['gaps']),330)
        self.assertEqual(self.manifest['counts']['issues']['interval_length_mismatch'],14)
        self.assertEqual(self.manifest['counts']['issues']['no_assay'],4)

    def test_every_interval_endpoints(self):
        collars=self.data['collar']['geometry']
        for row,geom in zip(self.data['drill']['rows'],self.data['drill']['geometry']):
            self.assertIsNotNone(geom)
            ci,top,bottom=geom
            self.assertAlmostEqual(top,collars[ci][2]-row[1])
            self.assertAlmostEqual(bottom,collars[ci][2]-row[2])
            self.assertGreater(top,bottom)
            self.assertEqual(self.data['collar']['rows'][ci][0],row[0])

    def test_original_elevations_and_band_prefix(self):
        for row,geom in zip(self.data['surface']['rows'],self.data['surface']['geometry']):
            self.assertEqual(row[1:3],geom[:2])
            if geom[3]=='original': self.assertEqual(row[53],geom[2])
            else: self.assertTrue(3500<geom[2]<6500)
        for row,geom in zip(self.data['collar']['rows'],self.data['collar']['geometry']):
            self.assertAlmostEqual(row[1]-31000000,geom[0])
            self.assertEqual(row[2:4],geom[1:3])

    def test_units_and_species(self):
        chemicals={c['id']:c for c in self.manifest['chemistry']}
        for name in ['Cu','Mo','Pb','Zn']:
            self.assertEqual(chemicals[name]['unit'],'ppm')
            self.assertEqual(chemicals[name]['columns']['drill']['factor'],10000)
        for name in ['CaO','MgO','MnO','Al2O3','CaO R']:
            self.assertEqual(chemicals[name]['unit'],'%')
            self.assertEqual(chemicals[name]['columns']['surface']['factor'],1)

    def test_dem_residual_reference(self):
        entry=next(r for r in self.manifest['comparisons'] if r['epsg']==4540 and r['group']=='surface')
        self.assertAlmostEqual(entry['mae'],14.40,delta=.03)
        self.assertAlmostEqual(entry['rmse'],28.03,delta=.03)
        self.assertIn('Ballpark',entry['operation'])

    def test_actual_geotiff_pixel_is_point(self):
        with rasterio.open(next((ROOT/'data/dem').glob('*.tif'))) as src:
            self.assertEqual(src.tags()['AREA_OR_POINT'],'Point')
            self.assertAlmostEqual(src.xy(0,0)[0],91.)
            self.assertAlmostEqual(src.xy(0,0)[1],30.)
            raster=src.read(1)
            # Independent rasterio pixel-centre coordinate, exact source elevation.
            e,n=src.xy(500,600)
            z=bilinear(raster,src.transform,np.array([e]),np.array([n]),src.nodata)
            self.assertAlmostEqual(z[0],float(raster[500,600]),places=5)


if __name__=='__main__':
    unittest.main()
