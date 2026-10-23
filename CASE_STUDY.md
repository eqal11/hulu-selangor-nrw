# Hulu Selangor NRW Monitor: case study

## Business problem

A water utility needs to understand where supplied water is not converted into billed authorised consumption. Area-level balances can indicate where further investigation is needed, but analysts also need network context and confidence in the underlying records. A high NRW percentage alone does not identify a leak location or justify a pipe replacement.

This project demonstrates that review workflow using fictional district metered areas around Hulu Selangor, Malaysia. All data is synthetic, for demonstration only. It does not describe an actual utility's assets, losses or operating performance.

## Users and decisions

**NRW analysts and distribution engineers** compare monthly and annual DMA rankings, then examine the water balance and mapped infrastructure. The view helps them shortlist areas for investigation and distinguish a high percentage from a large loss volume. The combined NRW KPI is volume weighted; annual DMA rankings use mean monthly percentages, so those measures require different interpretations.

**Leak response coordinators** locate reports, inspect recorded status and compare estimated daily loss. Open includes reports marked open or in progress within the selected reporting period. Without repair timestamps, the dashboard cannot reconstruct the unresolved backlog at a past date or estimate cumulative losses from each incident.

**GIS and asset data administrators** use the QA/QC tab to filter issues, locate affected features and export a review list. Missing attributes, repeated identifiers and broken references are made visible before those records are used for asset planning. Proximity and boundary flags are prompts for review, not automatic instructions to change the network.

## What was built

The deliverable is a static Leaflet application with switchable basemaps, DMA choropleths, material-coloured pipes, asset symbols and leak markers. A reporting-period selector drives KPIs, ranking and DMA colours. Table and map selections are linked, and a selected DMA shows its water balance components, pipe length, average known installation age and unresolved report count. The layout uses a desktop side panel and a collapsible mobile bottom sheet.

A seeded Node.js generator supplies eight DMAs, network segments, assets, reports and twelve monthly balances per DMA. It also logs deliberately injected defects. Browser checks return 23 issue records and match all 20 logged injections because duplicate groups flag both members. This result confirms the intended synthetic test cases are detected; it is not evidence of real-world detection accuracy. No operational savings or service improvements have been measured.

## Moving to real utility data

A production version would first establish consistent DMA identifiers, surveyed boundaries, asset ownership and meter/billing periods. It would preserve source provenance, document units and uncertainty, and record repair/status timestamps. Analysts would agree whether annual DMA reporting should use volume ratios or mean monthly percentages.

Connectivity tolerances and boundary checks would need validation against surveyed assets and known exceptions. Hydraulic model integration could add pressure and flow context. Pipe risk scoring would need observed failures, condition and consequence data. Secure ingestion, role-based access, issue ownership and an audit trail would support operational use, followed by validation with utility staff before decisions relied on the results.
