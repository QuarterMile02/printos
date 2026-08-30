select table_name, column_name, data_type, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'purchase_orders' and column_name in ('subtotal','tax_total','total'))
    or (table_name = 'purchase_order_items' and column_name in ('unit_cost','total_cost'))
  )
order by table_name, column_name;
