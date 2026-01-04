# local_ml_server.py — optional Flask server providing page intent and paragraph classification
from flask import Flask, request, jsonify
import joblib
from pathlib import Path
import logging
import traceback

app = Flask('anime_filter_ml')
LOG = logging.getLogger('anime_filter_ml')
logging.basicConfig(level=logging.INFO)

MODELS_DIR = Path(__file__).resolve().parent.parent / 'ml' / 'models'

# thresholds (mirror extension)
PAGE_INTENT_BLOCK_PROB = 0.80
PARAGRAPH_BLOCK_PROB = 0.80

# Try loading models if present
def safe_load(path):
    try:
        return joblib.load(path)
    except Exception as e:
        LOG.warning(f"Model load failed: {path} -> {e}")
        return None

domain_model = safe_load(MODELS_DIR / 'domain_model.pkl')
page_model = safe_load(MODELS_DIR / 'page_model.pkl')
paragraph_model = safe_load(MODELS_DIR / 'paragraph_model.pkl')  # expects predict_proba

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True, 'models': {
        'domain_model': bool(domain_model),
        'page_model': bool(page_model),
        'paragraph_model': bool(paragraph_model)
    }})

@app.route('/classify_page', methods=['POST'])
def classify_page():
    try:
        data = request.get_json() or {}
        url = data.get('url','').lower()
        # very simple: use page_model if available; otherwise unknown
        if page_model:
            # page_model expects the URL title or path as text input
            X = [url]
            if hasattr(page_model, "predict_proba"):
                probs = page_model.predict_proba(X)[0]
                # assume classes ['good','bad'] or similar; try to map
                classes = page_model.classes_.tolist()
                # find probability of 'bad' or 'sexual' class
                prob_bad = 0.0
                for cls, p in zip(classes, probs):
                    if str(cls).lower() in ('bad','sexual','adult','porn','suspicious'):
                        prob_bad = p
                decision = 'block' if prob_bad >= PAGE_INTENT_BLOCK_PROB else 'allow'
                return jsonify({'decision': decision, 'prob': prob_bad, 'label': 'sexual' if prob_bad>=PAGE_INTENT_BLOCK_PROB else 'allow'})
            else:
                pred = page_model.predict([url])[0]
                decision = 'block' if str(pred).lower() in ('bad','sexual','adult') else 'allow'
                return jsonify({'decision': decision, 'prob': None, 'label': pred})
        else:
            return jsonify({'decision':'unknown','reason':'no-page-model'})
    except Exception as e:
        LOG.error(traceback.format_exc())
        return jsonify({'decision':'error','error':str(e)}), 500

@app.route('/classify_paragraph', methods=['POST'])
def classify_paragraph():
    try:
        data = request.get_json() or {}
        text = data.get('text','')
        if not text:
            return jsonify({'label':'safe','prob':0.0})
        if paragraph_model:
            # paragraph_model should be pipeline with predict_proba; classes include ['safe','suggestive','explicit']
            X = [text]
            if hasattr(paragraph_model, "predict_proba"):
                probs = paragraph_model.predict_proba(X)[0]
                classes = paragraph_model.classes_.tolist()
                # choose the max class
                max_i = int(probs.argmax()) if hasattr(probs, "argmax") else probs.index(max(probs))
                label = classes[max_i]
                prob = float(probs[max_i])
                # map to decision
                return jsonify({'label': str(label), 'prob': prob})
            else:
                pred = paragraph_model.predict(X)[0]
                return jsonify({'label': str(pred), 'prob': None})
        else:
            return jsonify({'label':'unknown','reason':'no-paragraph-model'})
    except Exception as e:
        LOG.error(traceback.format_exc())
        return jsonify({'label':'error','error':str(e)}), 500

if __name__ == '__main__':
    # run on localhost:5000
    app.run(host='127.0.0.1', port=5000)
