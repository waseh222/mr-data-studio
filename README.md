# Mr Data Studio — InsightForge v2.0

This is an early portfolio release of Mr Data, originally named InsightForge Analytics + AI Studio. The Python Plotly dependency supplies the charting JavaScript for this source distribution.

An **upgraded, local-first Windows data-science application** with a TLM-inspired command dashboard, real guided analytics, data editing/cleaning, interactive charts, statistics, model building with **holdout accuracy and a manual prediction console on the left**, local generative-AI chat, document RAG, and interactive lessons.

## Run locally

Install Python 3.11 or newer, create a virtual environment, then run `python -m pip install -r requirements.txt` and `python -m uvicorn app:app --host 127.0.0.1 --port 8765` from the repository root. Open http://127.0.0.1:8765.

## Windows D: drive installation

1. Download the ZIP and extract it to a temporary folder (or directly to `D:\InsightForge Analytics Studio`).
2. Run **`INSTALL_TO_D_DRIVE.bat`**, which copies the app to **`D:\InsightForge Analytics Studio`**. If an older `%USERPROFILE%\InsightForge Studio` dataset workspace exists and the D: workspace is empty, it is copied to D: **without deleting the original**.
3. Double-click `D:\InsightForge Analytics Studio\RUN_WINDOWS.bat`. It creates a Python environment under **D:**, installs packages to that environment, redirects pip cache/temp/python caches to **D:**, and opens a **native desktop window** using Microsoft Edge WebView2. If the embedded browser cannot start, a normal browser opens the local UI at **http://127.0.0.1:8765**.
4. Use Import Data (or Demo Data), then **Analysis Workbench** for guided charts, or **Model Builder** to train and test predictions.
5. To build a standalone Windows EXE, once dependencies are installed, run **`D:\InsightForge Analytics Studio\BUILD_WINDOWS_EXE.bat`**. The generated program will be `D:\InsightForge Analytics Studio\dist\InsightForge Studio v2\InsightForge Studio v2.exe` with its supporting libraries in that folder. It is a desktop WebView2 window, not a website hosted on the internet. This EXE has not been prebuilt or Windows-tested in the creation environment. The onedir build avoids one-file unpacking onto a nearly full C: drive.

**If you run `RUN_WINDOWS.bat` from C: and D: exists, it redirects to the D: installer automatically.** No file is deleted from C:. Check files on D: before manually removing older C: folders; only remove files you are certain are copies. The Python base interpreter might still be installed on C:, but the app, Python virtual environment and large data stores are on D:.

## What's new in v2

- **Native desktop wrapper:** embedded Edge WebView2 desktop window when available, with fallback to the local browser.
- **TLM-style UI:** dark navy sidebar, light dashboard, prominent quick-action buttons, clearer navigation, friendly guidance, dark-mode toggle, responsive layouts.
- **Analysis Workbench:** one-button automatic dashboard, real data quality, numeric distributions, grouped comparisons, monthly date trends, correlations, scatter plots, outlier detection. Each analysis offers figures and exact summary tables, and a self-contained HTML analysis report.
- **Model Builder:** manually select a target and features; Random Forest, Extra Trees, Gradient Boosting, Decision Tree, KNN, Logistic/Linear Regression and Ridge; real 80/20-style holdout evaluation; optional three-fold cross validation; feature importance/confusion matrix/scatter diagnostics. Models persist as local `.joblib` files on D:.
- **Left-side manual prediction console:** choose a saved model, enter each predictor value or choose a category, click Predict. Classification outputs a predicted label and class probabilities when supported.
- **Proper metrics:** classification accuracy %, balanced accuracy, precision, recall and weighted F1; regression R², MAE and RMSE. **Regression does not have a standard accuracy percentage**, so it is never mislabeled.
- **Generative AI Studio:** uses your own locally installed Ollama model; prompt starters and optional limited sample-data context. The app does not download or install an AI model automatically.
- **Document RAG:** upload TXT, MD, CSV, JSON, Python, Word, and text-based PDF documents; chunk text and retrieve matching excerpts with TF-IDF; optionally ask Ollama to answer using retrieved passages. Documents remain local. Scanned PDFs require a separate OCR tool (not included).
- **Interactive Academy:** eight short lessons (data exploration, cleaning, EDA, statistics, ML, GenAI, RAG, SQL), multiple-choice checks, progress saved locally, direct jump to practice tools.
- **D: storage:** `workspace/datasets`, `workspace/models`, `workspace/knowledge`, virtual environment, pip cache, and temporary files all live under D: after installation.

## Existing v1 capabilities preserved

Data imports: CSV/TSV, Excel, JSON/JSONL, Parquet, SQLite, ZIP, public URL, paste, synthetic demo. Editing: grid, search, sorting, direct cell editing, undo/redo, formulas. Cleaning: missing data, deduplication, scaling, conversion, outliers, filtering. Transformations: groupby, pivot, crosstab, joins, concat, melt, sampling, rolling mean. Visualization: 13 Plotly chart types, Matplotlib/Seaborn PNG. Statistics: correlation, linear regression, t-test, ANOVA, nonparametric tests, normality, chi-square. Read-only SQL; multiple data export formats and ZIP backup.

## Scope and limitations

- This is a substantial educational/exploratory v2, **not a clone of every commercial data-science suite** and not literally every feature of all Python libraries. Modules can be extended.
- The API listens on `127.0.0.1` only. Normal data analysis needs no internet after package installation. Public-URL data import explicitly downloads data. Ollama is local and is optional; its installation/model download is separate.
- Models have a holdout test, but no claim of external validity. Beware leakage and class imbalance. Model files are saved locally in Python's joblib format; **never load arbitrary untrusted joblib files**.
- Document RAG uses TF-IDF similarity, not an embeddings vector database; returned excerpts/scores are retrieval relevance, not answer-confidence estimates. Document upload limits apply. Avoid relying on it for high-stakes decisions.
- **Windows EXE build has not been completed** here. A local build with WebView2 is required for a true desktop window. Test on your own Windows machine before relying on workflows.
- No unrestricted Python script execution from uploaded data, no arbitrary model training from untrusted code, no cloud collaboration, and no built-in paid LLM API keys.
- Maximum per-dataset size: 200,000 rows × 400 columns, 30 datasets. Charts may sample up to 30,000 rows; ML training samples up to 20,000 rows. Up to 12 trained models and 12 knowledge documents are stored locally.

## Developer notes

Run `python -m pytest -q` after `pip install pytest httpx`. Source files: `app.py` API, `analytics_core.py` original core, `studio_plus.py` advanced features, `static/app.js` basic UI, `static/studio_v2.js` guided analytics/AI/lessons, `static/styles.css` base, `static/studio_v2.css` visual redesign, `tests/` regression tests.

**Optional D: local-model storage:** Run `SET_OLLAMA_STORAGE_TO_D.bat` before downloading an Ollama model; this changes your Windows user `OLLAMA_MODELS` setting, requires restarting Ollama, and does not move existing models.

**Optional browser mode:** Double-click `RUN_WEB_VERSION.bat` after first-time setup. **Ollama storage:** set `OLLAMA_MODELS` to a directory on D: before downloading local LLM weights; Ollama must be restarted to read a changed environment variable.
