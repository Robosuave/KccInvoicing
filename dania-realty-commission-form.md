# Dania Realty Commission / Wire Instruction Form — structure notes

User's existing real-estate invoice form (photo received 2026-10-03, file: Dania_Realty_Commission_...).
Layout documented for the new app's template design. Bank account details from the photo are NOT
recorded here; they live in the user's own document.

## Layout

- Header (teal/mint geometric design): Dania Realty, Inc / 2800 N 46th AV A608 / Hollywood, FL 33021 / 954.441.4540
- DATE field
- Agent name line(s), including "Second Sales Person (if applicable)"
- Section: DESCRIPTION / COMMISSION & FEES
  - Real Estate Commission: [ % ] $ [ ]
  - Processing Fee: pre-filled $295.00
  - Other Charge: [description] [amount]
  - TOTAL: $ [ ]
- Section: WIRE INSTRUCTIONS (shaded box)
  - Bank name, routing number, account number
  - Dania Realty, Inc. address block + Phone: 954.441.4540
  - Zelle: RobKaleky@gmail.com
- Footer: "Commission / Wire Instruction Form | Dania Realty, Inc." / "Verify wire instructions before payment."

## Mapping to the new app (My Business Invoice Desk)

- This is a second invoice TEMPLATE for the Dania Realty business — distinct from the
  standard line-item consulting invoice template.
- Template needs: commission % input, processing fee with default value ($295.00), other-charge
  line, wire-instructions block rendered from the business's payment instructions.
- Business defaults for Dania Realty: processing fee default $295.00; payment instructions =
  wire instructions + Zelle email (stored in DB as business payment instructions per SPEC.md §1).
- Percentage-based commission line implies support for a line type that computes from a
  percentage of a sale price — flag as a template/editor requirement (custom calculation).
- Notes field could hold agent names / second sales person — or typed custom fields (text)
  per SPEC.md §9.
