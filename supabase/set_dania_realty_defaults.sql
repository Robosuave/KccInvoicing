-- Set Dania Realty's defaults: commission invoice type + wire instructions.
-- Run AFTER migration 0004 (which adds the default_template column).

update public.businesses
set
  default_template = 'commission',
  payment_instructions =
'WIRE INSTRUCTIONS
Bank Name: [add your bank name]
Routing Number: [add routing number]
Account Number: [add account number]

Dania Realty, Inc.
2800 N 46th AV A608
Hollywood, FL 33021
Phone: 954.441.4540

Zelle: RobKaleky@gmail.com

Verify wire instructions before payment.'
where display_name ilike '%dania%realty%';
