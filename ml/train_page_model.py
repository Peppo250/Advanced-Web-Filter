# train_page_model.py — build a page intent classifier (URL+title -> good/bad)
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib
from pathlib import Path

DATA_CSV = Path(__file__).resolve().parent.parent / 'data' / 'page_sample_for_training.csv'  # expected columns: url,title,label
OUT_PATH = Path(__file__).resolve().parent / 'models' / 'page_model.pkl'

def load():
    df = pd.read_csv(DATA_CSV)
    df = df.fillna('')
    df['text'] = (df['url'].astype(str) + ' ' + df['title'].astype(str)).str.lower()
    return df

if __name__ == '__main__':
    df = load()
    X = df['text']
    y = df['label']
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42, stratify=y)
    model = make_pipeline(TfidfVectorizer(ngram_range=(1,2), max_features=10000), LogisticRegression(max_iter=2000))
    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    print(classification_report(y_test, preds))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT_PATH)
    print('Saved page_model.pkl ->', OUT_PATH)
