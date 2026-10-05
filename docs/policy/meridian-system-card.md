# Meridian Lending — System Card

Meridian decides credit-limit changes for existing customers. We publish the decision
policy at /policies/credit-limit-v4.

## Data and training

- Data sources are listed in appendix A. We never train on applicant-uploaded documents.
- We retain application events for 2555 days.

## Human oversight

Human review is available for every adverse decision within two business days.
We monitor override rates monthly.

## Redress

An appeal is available for 30 days after a decision. Opt out is available in settings.

## Transparency

Explainability is available as a per-decision reason code. We measure subgroup disparity
across four cohorts.

## Known limitations

We do not offer an appeal route for automated identity checks.
