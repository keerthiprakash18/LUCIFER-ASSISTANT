# Imported Instagram data

Use an actual authorized export. This application does not scrape public profiles or infer private account metrics. It does not claim a live Instagram connection.

## CSV contract

UTF-8 CSV, optionally with a BOM; one post per row. Maximum 10 MB upload, 500,000 extracted characters, 10,000 post rows, and 20,000 characters per CSV record. The UI offers an **empty template**, not fabricated example metrics.

```csv
post_id,date,format,theme,caption,reach,views,impressions,likes,comments,shares,saves
```

- Required: `post_id`, `date`, `format`, `theme`.
- Optional: `caption` and all seven metric columns.
- `post_id`: unique within the export, up to 100 characters.
- `date`: a real `YYYY-MM-DD` publication date interpreted in the selected reporting timezone.
- `format`: source format name, up to 60 characters. Keep the source terminology.
- `theme`: owner-labelled topic, up to 120 characters. This supplies creative context.
- `caption`: up to 500 characters. Quote CSV values containing commas or newlines.
- Metrics: safe, nonnegative integer counts. Blank/missing means **unavailable**; `0` is an actual supplied zero. Negative, malformed, fractional, and unsafe-size values are rejected.
- Duplicate IDs, duplicate/unknown headers, prototype-like columns, inconsistent rows, and invalid dates are rejected.

Normalize headers from your export deliberately. Do not rename `views` to `impressions`, or fill unavailable fields with guesses. Reports preserve the actual column terminology.

## Interpretation

- The selected start/end dates filter **post publication dates** inclusively. “Last 30 days” defaults to today and the previous 29 dates in the selected timezone.
- Values are whatever the export actually measured. Lifetime post metrics do not become last-30-days observations merely because the posts were published recently. The PDF explicitly states that metric observation windows are not independently verified.
- Metric totals sum supplied post values. Coverage shows `posts with this field / posts selected`.
- Sum of post reach is **not deduplicated account reach**.
- Rankings use the first completely supplied comparable metric: views, reach, impressions, likes, comments, shares, or saves. No complete metric means no comparative ranking.
- Format averages use that same ranking metric and the number of supplied posts in each format.
- Interaction rate is `(likes + comments + shares + saves) / sum of post reach × 100`, only when all five fields are complete and reach is positive. Otherwise it is unavailable.
- Repeated themes are counts of owner-labelled topics. They are not causal audience explanations.
- Followers, follower change, accounts engaged, demographics, account-level totals, and comparable previous-period changes are unavailable in this initial schema.
- Exactly six briefs are rule-based creative proposals linked to the observed strongest theme or a supplied theme when ranking is unavailable. They do not promise performance.

Keep different brands in separate memory contexts and choose the correct account/brand/logo when creating each report. Export filenames and retrieval times are retained as provenance. Use Files & reports to delete source/generated files or change retention for new files.

PDF extraction supports embedded text. Scans without text are rejected with an OCR limitation. Font shaping, especially in some Tamil PDFs, can produce reordered extracted text even when visual rendering is correct; upload a plain-text export when extraction is not readable. Uploaded instructions and macros are never executed.
