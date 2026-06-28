import sys
from pathlib import Path
import unittest
import json

# Resolve absolute paths to import the backend module dynamically
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from backend.local_ml_server import app

class TestMLServer(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_health(self):
        """Test that the /health endpoint responds and reports model loading status."""
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data['ok'])
        self.assertIn('models', data)
        self.assertIn('page_model', data['models'])
        self.assertIn('paragraph_model', data['models'])

    def test_classify_page(self):
        """Test that /classify_page processes URL and title payloads and makes decisions."""
        payload = {
            'url': 'https://wikipedia.org/wiki/Software_engineering',
            'title': 'Software engineering - Wikipedia'
        }
        response = self.client.post('/classify_page', 
                                    data=json.dumps(payload),
                                    content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('decision', data)
        self.assertIn('prob', data)
        self.assertIn('label', data)
        # Verify the decision is allowed or blocked rather than an error
        self.assertIn(data['decision'], ['allow', 'block', 'unknown'])

    def test_classify_paragraph(self):
        """Test that /classify_paragraph evaluates text inputs for safety levels."""
        payload = {
            'text': 'A wholesome story about a boy learning to be a ninja.'
        }
        response = self.client.post('/classify_paragraph',
                                    data=json.dumps(payload),
                                    content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('label', data)
        self.assertIn('prob', data)

if __name__ == '__main__':
    unittest.main()
