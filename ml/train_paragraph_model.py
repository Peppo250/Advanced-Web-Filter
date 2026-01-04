# train_paragraph_model.py — train paragraph semantic classifier (safe | suggestive | explicit)
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib
from pathlib import Path

DATA_CSV = '../data/paragraph_sample_for_training.csv'  # expected columns: text,label
OUT_PATH = Path(__file__).resolve().parent / 'models' / 'paragraph_model.pkl'

def load_data():
    df = pd.read_csv(DATA_CSV)
    df = df.fillna('')
    df['text_clean'] = df['text'].str.lower()
    return df

if __name__ == '__main__':
    df = load_data()
    X = df['text_clean']
    y = df['label']  # classes: safe, suggestive, explicit
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    pipeline = make_pipeline(TfidfVectorizer(ngram_range=(1,2), max_features=20000), LogisticRegression(max_iter=2000))
    pipeline.fit(X_train, y_train)
    preds = pipeline.predict(X_test)
    print(classification_report(y_test, preds))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, OUT_PATH)
    print('Saved paragraph_model.pkl ->', OUT_PATH)
