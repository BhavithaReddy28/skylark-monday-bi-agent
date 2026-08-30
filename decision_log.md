# Decision Log: Skylark Drones BI Agent

This document records the key assumptions, technical trade-offs, design choices, and feature interpretations made during the development of the Monday.com Business Intelligence Agent.

---

## 1. Key Assumptions
* **Data Association via Deal Name:** Since there is no explicit matching primary key, we linked the **Work Orders** board and **Deals** board by the `Deal Name` (represented as `Deal name masked` in the Work Orders Excel sheet). Our preprocessing script isolates and cleans names to ensure perfect linkage (identifying 52 common deal entities).
* **Calendar Year Quarters:** We assumed standard Calendar Year quarters (Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec) for evaluating timeline close dates and actual billing/delivery dates.
* **Closure Probability Mapping:** In the Deals sheet, closure probability was stored as qualitative text ("High", "Medium", "Low", and missing values). We mapped these to numerical weights (High: 90%, Medium: 50%, Low: 15%, missing won: 100%, missing open: 30%) to enable calculations of the **Weighted Sales Pipeline Forecast**.
* **Financial Unit Normalization:** We assumed quantities (e.g. ops quantities written as "5360 HA" or "4") and masked pricing numbers (e.g. values written with commas or currency indicators) can be parsed using regex to extract purely numerical metrics.

---

## 2. Selected Trade-offs & Rationale
* **Node.js Express Server + HTML/Vanilla CSS Frontend:**
  * *Trade-off:* We built a unified Express API and Vanilla CSS SPA instead of a framework like Next.js or Vite.
  * *Why:* This allows the application to execute extremely fast, bundle all dependencies into a single, clean footprint, and completely bypasses Monday.com Personal API Token CORS restrictions (as personal tokens are blocked on client-side requests).
* **Dynamic Monday.com Integration with "Demo Mode" Fallback:**
  * *Trade-off:* Setting up real Monday.com boards can be friction-heavy. We built a toggle switch in the UI.
  * *Why:* By default, the application runs in **Demo Mode**, loading, cleaning, and querying the Excel files locally. However, if the user inputs their Monday.com API Token and clicks "Sync Excel", the app dynamically creates the boards, populates them, and transitions into **Live Monday.com Mode** querying the boards via API. This ensures the app is 100% testable out-of-the-box without setup, while demonstrating a live production integration.
* **Dual NLP Querying Engine:**
  * *Trade-off:* Forcing a Gemini API key can stop users from testing conversational features.
  * *Why:* If the user has no Gemini key, the backend uses a local **Rule-Based Semantic Parser** that identifies keywords (like "revenue", "pipeline", "Outstanding AR", "Mining Sector") and responds with structured summaries and charts. If a Gemini API key is provided, the backend orchestration builds a context package of the cleaned data, forwards it to Gemini, and generates deep operational insights.

---

## 3. Interpretation of "Leadership Updates"
We interpreted the leadership updates requirement as the ability for executives to quickly generate formatted, shareable summaries for slide decks, board meetings, or email threads.
* **Quarterly and Sectoral Filters:** We built a dedicated "Leadership Reports" tab. Founders can filter data by quarter or sector.
* **Structured Executive Content:** The generator compiles KPI summaries, pipeline health states, financial cashflow status (billing vs collection), data quality warning statements, and strategic recommendations (e.g. prioritising high-value collection targets).
* **Export Workflows:** We added **"Copy Raw Markdown"** and **"Download Report (.md)"** buttons. This lets users instantly copy the content to paste into an email or drop into a markdown presentation builder.

---

## 4. Future Improvements (Given More Time)
* **Dynamic Board Mapping (Schema Schema):** Instead of assuming fixed column names, create a visual field-mapping screen so that if the column headers in Monday.com change in the future, the user can map them directly in the UI.
* **Automated Data Alerts (Slack/Email Webhooks):** Integrate Slack webhooks to automatically notify operations managers when a work order transitions to "Pause/struck" or when a receivable goes past 90 days.
* **Full GraphQL Filtering:** Query only relevant subsets of items from Monday.com instead of loading all items (up to 500) into memory, which would optimize performance for much larger databases.
