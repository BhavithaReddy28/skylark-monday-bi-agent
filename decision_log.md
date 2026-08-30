# Decision Log: Skylark Drones BI Agent

This document records the key assumptions, technical trade-offs, design choices, and feature interpretations made during the development of the Monday.com Business Intelligence Agent.

---

## 1. Key Assumptions
* **Data Association via Deal Name:** Since there is no explicit matching primary key, we linked the **Work Orders** board and **Deals** board by the `Deal Name` (represented as `Deal name masked` in the Work Orders Excel sheet). Our preprocessing script isolates and cleans names to ensure perfect linkage (identifying 52 common deal entities).
* **Calendar Year Quarters:** We assumed standard Calendar Year quarters (Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec) for evaluating timeline close dates and actual billing/delivery dates.
* **Closure Probability Mapping:** In the Deals sheet, closure probability was stored as qualitative text ("High", "Medium", "Low", and missing values). We mapped these to numerical weights (High: 90%, Medium: 50%, Low: 15%, missing won: 100%, missing open: 30%) to enable calculations of the **Weighted Sales Pipeline Forecast**.
* **Financial Unit Normalization:** We assumed quantities and masked pricing numbers (e.g. values written with commas or currency indicators) can be parsed using regex to extract purely numerical metrics.

---

## 2. Selected Trade-offs & Rationale
* **Next.js (App Router) + Tailwind CSS over Vanilla Express:**
  * *Trade-off:* We completely refactored the app from a Vanilla Express/HTML app to a modern **Next.js** stack with **Tailwind CSS**.
  * *Why:* This allows the application to be deployed seamlessly on **Vercel** with zero configuration. It also provides a drastically better development experience with React components (like Recharts for dynamic dashboarding and ReactMarkdown for beautiful LLM output rendering).
* **Server-Side API Routes for Secure Keys:**
  * *Trade-off:* We route all Monday.com GraphQL calls and Gemini SDK calls through Next.js backend API routes (`/api/*`) instead of calling them directly from the browser.
  * *Why:* Monday.com Personal API Tokens are strictly blocked by browser-side CORS policies. Furthermore, placing the Gemini API key in the frontend would expose it to users. The backend routes securely proxy all requests, parse the payloads, and keep keys completely hidden.
* **Dual NLP Querying Engine:**
  * *Trade-off:* Forcing a Gemini API key can stop users from testing conversational features if they don't have one ready.
  * *Why:* If the user has no Gemini key, the backend uses a local **Rule-Based Semantic Parser** that identifies keywords (like "revenue", "pipeline", "Outstanding AR") and responds with structured summaries and charts. If a Gemini API key is provided, the backend orchestration builds a context package of the cleaned data, forwards it to Gemini 3.6 Flash, and generates deep operational insights.

---

## 3. Interpretation of "Leadership Updates"
We interpreted the leadership updates requirement as the ability for executives to quickly generate formatted, shareable summaries for slide decks, board meetings, or email threads.
* **Quarterly and Sectoral Filters:** We built a dedicated "Leadership Reports" tab. Founders can filter data by quarter or sector.
* **Structured Executive Content:** The generator compiles KPI summaries, pipeline health states, financial cashflow status (billing vs collection), data quality warning statements, and strategic recommendations.
* **Export Workflows:** We built the outputs to natively render as Markdown in the browser (using ReactMarkdown + remark-gfm), ensuring that tables, bolding, and lists render gorgeously to the user immediately, while also allowing them to easily copy/paste the formatted output into emails or docs.

---

## 4. Future Improvements (Given More Time)
* **Dynamic Board Mapping (Schema Mapping):** Instead of assuming fixed column names (e.g., "Deal Stage", "Closure Probability"), create a visual field-mapping screen so that if the column headers in Monday.com change in the future, the user can map them directly in the UI.
* **Automated Data Alerts (Slack/Email Webhooks):** Integrate Slack webhooks to automatically notify operations managers when a work order transitions to "Pause/struck" or when a receivable goes past 90 days.
* **Full GraphQL Filtering & Pagination:** Query only relevant subsets of items from Monday.com using GraphQL filters instead of loading all items into memory at once. This would dramatically optimize performance for databases with 10,000+ items.
