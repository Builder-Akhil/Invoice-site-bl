export type DocType = 'invoice' | 'quote';

export type TaxMode = 'intra' | 'inter' | 'export_lut' | 'export_paid' | 'exempt';

export type GstTreatment =
  | 'registered_business'
  | 'unregistered_business'
  | 'consumer'
  | 'overseas'
  | 'sez_with_payment'
  | 'sez_without_payment'
  | 'deemed_export';

export const GST_TREATMENTS: { value: GstTreatment; label: string; hint: string }[] = [
  { value: 'registered_business', label: 'Registered Business — Regular', hint: 'Has a GSTIN. Normal GST applies.' },
  { value: 'unregistered_business', label: 'Unregistered Business', hint: 'No GSTIN. GST still charged.' },
  { value: 'consumer', label: 'Consumer (B2C)', hint: 'Individual, no GSTIN.' },
  { value: 'overseas', label: 'Overseas Business', hint: 'Export of service. Zero-rated under LUT, or IGST if paid.' },
  { value: 'sez_with_payment', label: 'SEZ — with payment of tax', hint: 'IGST charged, refund claimed.' },
  { value: 'sez_without_payment', label: 'SEZ — under LUT/Bond', hint: 'Zero-rated, no tax charged.' },
  { value: 'deemed_export', label: 'Deemed Export', hint: 'Treated as export under GST.' },
];

export type InvoiceStatus =
  | 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid'
  | 'overdue' | 'cancelled' | 'accepted' | 'declined';

export interface CompanyProfile {
  id: number;
  legal_name: string; trade_name: string | null; entity_type: string;
  gstin: string | null; pan: string | null; cin_llpin: string | null;
  contact_person: string | null; designation: string | null;
  email: string | null; phone: string | null; website: string | null;
  address_line1: string | null; address_line2: string | null; city: string | null;
  state: string | null; state_code: string | null; pincode: string | null; country: string | null;
  logo_url: string | null; signature_url: string | null; signatory_name: string | null;
  bank_account_name: string | null; bank_account_no: string | null; bank_ifsc: string | null;
  bank_swift: string | null; bank_name: string | null; bank_branch: string | null;
  beneficiary_name: string | null; upi_id: string | null;
  invoice_prefix: string; invoice_padding: number; next_invoice_no: number;
  quote_prefix: string; quote_padding: number; next_quote_no: number;
  default_due_days: number; default_terms: string | null; default_notes: string | null;
  default_sac: string | null; default_gst_rate: number; lut_number: string | null;
  fy_start_month: number;
}

export interface Client {
  id: string;
  company_name: string; display_name: string | null;
  contact_person: string | null; contact_designation: string | null;
  email: string | null; cc_emails: string | null;
  work_phone: string | null; mobile: string | null; website: string | null;
  gst_treatment: GstTreatment; gstin: string | null; pan: string | null;
  place_of_supply_state: string | null; place_of_supply_code: string | null;
  is_overseas: boolean; currency: string;
  bill_attention: string | null; bill_line1: string | null; bill_line2: string | null;
  bill_city: string | null; bill_state: string | null; bill_pincode: string | null; bill_country: string | null;
  ship_same_as_bill: boolean; ship_line1: string | null; ship_line2: string | null;
  ship_city: string | null; ship_state: string | null; ship_pincode: string | null; ship_country: string | null;
  payment_terms_days: number; default_sac: string | null; default_gst_rate: number | null;
  tds_applicable: boolean; tds_section: string | null; tds_rate: number | null;
  opening_balance: number; status: string; notes: string | null;
  created_at: string;
}

export interface CatalogItem {
  id: string; name: string; description: string | null;
  kind: 'service' | 'goods'; code_type: 'SAC' | 'HSN'; code: string | null;
  unit: string; rate: number; currency: string; gst_rate: number; is_active: boolean;
}

export interface InvoiceLine {
  id?: string;
  position: number;
  item_id?: string | null;
  name: string;
  description: string | null;
  code_type: string;
  code: string | null;
  unit: string;
  quantity: number;
  rate: number;
  discount_pct: number;
  taxable_value: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_rate: number;
  cess_amount: number;
  line_total: number;
}

export interface Invoice {
  id: string;
  doc_type: DocType;
  invoice_number: string;
  client_id: string | null;
  client_snapshot: Partial<Client> | null;
  invoice_date: string;
  due_date: string | null;
  terms_label: string | null;
  subject: string | null;
  place_of_supply: string | null;
  place_of_supply_code: string | null;
  tax_mode: TaxMode;
  reverse_charge: boolean;
  lut_number: string | null;
  currency: string;
  exchange_rate: number;
  status: InvoiceStatus;
  subtotal: number; discount_total: number;
  cgst_total: number; sgst_total: number; igst_total: number; cess_total: number;
  tax_total: number; round_off: number; total: number;
  amount_paid: number; balance_due: number;
  tds_applicable: boolean; tds_section: string | null; tds_rate: number | null; tds_amount: number;
  notes: string | null; terms: string | null; internal_notes: string | null; po_number: string | null;
  public_token: string | null;
  sent_at: string | null; viewed_at: string | null; paid_at: string | null;
  recurring_id: string | null; converted_from: string | null;
  created_at: string; updated_at: string;
  invoice_items?: InvoiceLine[];
  clients?: Client | null;
}

export interface Payment {
  id: string; invoice_id: string; client_id: string | null;
  payment_date: string; amount: number; currency: string; exchange_rate: number;
  mode: string; reference: string | null; deposit_to: string | null;
  tds_deducted: number; bank_charges: number; notes: string | null; created_at: string;
}

export interface Expense {
  id: string; expense_date: string; vendor_name: string; vendor_gstin: string | null;
  category: string; description: string | null; bill_number: string | null; code: string | null;
  taxable_amount: number; gst_rate: number;
  cgst_amount: number; sgst_amount: number; igst_amount: number; total_amount: number;
  itc_eligible: boolean; is_reverse_charge: boolean;
  currency: string; exchange_rate: number;
  payment_mode: string | null; paid_by: string | null; reference: string | null;
  billable_to: string | null; attachment_url: string | null; notes: string | null; created_at: string;
}

export interface GstPayment {
  id: string; period_type: string; period: string; return_type: string;
  filed_on: string | null; paid_on: string | null; challan_no: string | null;
  igst_paid: number; cgst_paid: number; sgst_paid: number; cess_paid: number;
  interest: number; late_fee: number; itc_utilised: number; total_paid: number;
  status: string; arn: string | null; notes: string | null; created_at: string;
}

export interface RecurringProfile {
  id: string; title: string; client_id: string; frequency: string;
  start_date: string; end_date: string | null; next_run_date: string; day_of_month: number | null;
  currency: string; amount: number; line_items: InvoiceLine[];
  subject: string | null; notes: string | null; terms: string | null;
  due_days: number; auto_send: boolean; is_active: boolean; last_run_at: string | null;
  clients?: Client | null;
}

export const EXPENSE_CATEGORIES = [
  'Software & Subscriptions', 'Cloud & Infrastructure', 'AI / API Credits',
  'Contractor & Freelance', 'Salaries & Wages', 'Professional Fees',
  'Marketing & Advertising', 'Travel', 'Meals & Entertainment', 'Office & Rent',
  'Equipment & Hardware', 'Bank Charges', 'Statutory & Compliance', 'Training & Education', 'Other',
];

export const UNITS = ['qty', 'hour', 'day', 'month', 'project', 'user', 'sprint', 'license'];

export interface ChatAttachment {
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
  preview?: string;
}

export interface ChatDraft {
  id: string;
  invoice_number: string;
  total: number;
  currency: string;
  client_name: string;
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  draft?: ChatDraft | null;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: ChatAttachment[];
  draft: ChatDraft | null;
  created_at: string;
}

export const PAYMENT_MODES = [
  { value: 'bank_transfer', label: 'Bank Transfer / NEFT' },
  { value: 'upi', label: 'UPI' },
  { value: 'wire', label: 'International Wire' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];
