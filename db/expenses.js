/**
 * Project expense queries: projects, categories, receipts and their line items.
 * All money is integer cents.
 */

import { getDb } from './database.js';

const db = () => getDb();

export const RECEIPT_STATUSES = ['draft', 'submitted', 'approved', 'reimbursed'];

// ─── Projects ───────────────────────────────────────────────

export function listProjects() {
  return db().prepare(`
    SELECT p.*,
           COUNT(r.id)                       AS receipt_count,
           COALESCE(SUM(r.total_cents), 0)   AS spent_cents
    FROM expense_projects p
    LEFT JOIN expense_receipts r ON r.project_id = p.id AND r.status != 'draft'
    GROUP BY p.id
    ORDER BY p.status = 'closed', p.created_at DESC
  `).all();
}

export function getProject(id) {
  return db().prepare('SELECT * FROM expense_projects WHERE id = ?').get(id);
}

export function createProject({ name, description, budget_cents, created_by }) {
  const result = db().prepare(`
    INSERT INTO expense_projects (name, description, budget_cents, created_by)
    VALUES (?, ?, ?, ?)
  `).run(name, description || null, budget_cents ?? null, created_by || null);
  return getProject(result.lastInsertRowid);
}

export function updateProject(id, { name, description, budget_cents, status }) {
  const fields = [];
  const params = { id };
  if (name !== undefined) { fields.push('name = @name'); params.name = name; }
  if (description !== undefined) { fields.push('description = @description'); params.description = description || null; }
  if (budget_cents !== undefined) { fields.push('budget_cents = @budget_cents'); params.budget_cents = budget_cents; }
  if (status !== undefined) { fields.push('status = @status'); params.status = status; }
  if (fields.length) {
    db().prepare(`UPDATE expense_projects SET ${fields.join(', ')} WHERE id = @id`).run(params);
  }
  return getProject(id);
}

// ─── Categories ─────────────────────────────────────────────

export function listCategories() {
  return db().prepare('SELECT name FROM expense_categories ORDER BY sort_order, name').all().map(r => r.name);
}

export function addCategory(name) {
  db().prepare(`
    INSERT OR IGNORE INTO expense_categories (name, sort_order)
    VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM expense_categories WHERE name != 'Other'))
  `).run(name);
  // Keep "Other" last
  db().prepare(`
    UPDATE expense_categories SET sort_order = (SELECT MAX(sort_order) + 10 FROM expense_categories)
    WHERE name = 'Other'
  `).run();
  return listCategories();
}

// ─── Receipts ───────────────────────────────────────────────

function itemsFor(receiptId) {
  return db().prepare(
    'SELECT * FROM expense_items WHERE receipt_id = ? ORDER BY line_no, id'
  ).all(receiptId);
}

export function getReceipt(id) {
  const receipt = db().prepare('SELECT * FROM expense_receipts WHERE id = ?').get(id);
  if (!receipt) return null;
  receipt.items = itemsFor(id);
  return receipt;
}

export function listReceipts({ project_id, status } = {}) {
  let sql = `
    SELECT r.*,
           (SELECT COUNT(*) FROM expense_items i WHERE i.receipt_id = r.id) AS item_count
    FROM expense_receipts r
    WHERE r.project_id = @project_id`;
  const params = { project_id };
  if (status) { sql += ' AND r.status = @status'; params.status = status; }
  sql += ' ORDER BY COALESCE(r.purchase_date, r.created_at) DESC, r.id DESC';
  return db().prepare(sql).all(params);
}

export function createReceipt(fields) {
  const result = db().prepare(`
    INSERT INTO expense_receipts
      (project_id, paid_by, file_name, original_name, mime_type, file_size, extraction_status, created_by)
    VALUES
      (@project_id, @paid_by, @file_name, @original_name, @mime_type, @file_size, @extraction_status, @created_by)
  `).run({
    project_id: fields.project_id,
    paid_by: fields.paid_by || null,
    file_name: fields.file_name || null,
    original_name: fields.original_name || null,
    mime_type: fields.mime_type || null,
    file_size: fields.file_size ?? null,
    extraction_status: fields.extraction_status || 'pending',
    created_by: fields.created_by || null
  });
  return result.lastInsertRowid;
}

export function setReceiptFile(id, { file_name, mime_type, file_size }) {
  db().prepare(`
    UPDATE expense_receipts SET file_name = ?, mime_type = ?, file_size = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(file_name, mime_type, file_size, id);
}

const EDITABLE = [
  'vendor', 'purchase_date', 'subtotal_cents', 'tax_cents', 'total_cents',
  'paid_by', 'payment_method', 'notes', 'project_id'
];

/**
 * Update a receipt's header fields and (when `items` is given) replace its
 * line items, in one transaction.
 */
export const saveReceipt = (id, fields, items) => db().transaction(() => {
  const sets = [];
  const params = { id };
  for (const key of EDITABLE) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = @${key}`);
      params[key] = fields[key];
    }
  }
  sets.push("updated_at = datetime('now')");
  db().prepare(`UPDATE expense_receipts SET ${sets.join(', ')} WHERE id = @id`).run(params);

  if (Array.isArray(items)) {
    db().prepare('DELETE FROM expense_items WHERE receipt_id = ?').run(id);
    const insert = db().prepare(`
      INSERT INTO expense_items (receipt_id, line_no, description, quantity, unit_price_cents, amount_cents, category)
      VALUES (@receipt_id, @line_no, @description, @quantity, @unit_price_cents, @amount_cents, @category)
    `);
    items.forEach((item, i) => insert.run({
      receipt_id: id,
      line_no: i + 1,
      description: item.description || '',
      quantity: item.quantity ?? null,
      unit_price_cents: item.unit_price_cents ?? null,
      amount_cents: item.amount_cents ?? 0,
      category: item.category || null
    }));
  }
  return getReceipt(id);
})();

export function setExtractionResult(id, { status, error, json }) {
  db().prepare(`
    UPDATE expense_receipts
    SET extraction_status = ?, extraction_error = ?, extracted_json = COALESCE(?, extracted_json),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(status, error || null, json || null, id);
}

/**
 * Move a receipt through draft → submitted → approved → reimbursed.
 * Moving backward clears the later stages' fields.
 */
export function setReceiptStatus(id, status, { by, reimbursed_on, reimbursement_ref } = {}) {
  const params = { id, status, by: by || null, reimbursed_on: reimbursed_on || null, reimbursement_ref: reimbursement_ref || null };
  const approved = status === 'approved' || status === 'reimbursed';
  db().prepare(`
    UPDATE expense_receipts SET
      status = @status,
      approved_by = ${approved ? 'COALESCE(approved_by, @by)' : 'NULL'},
      approved_at = ${approved ? "COALESCE(approved_at, datetime('now'))" : 'NULL'},
      reimbursed_on = ${status === 'reimbursed' ? '@reimbursed_on' : 'NULL'},
      reimbursement_ref = ${status === 'reimbursed' ? '@reimbursement_ref' : 'NULL'},
      updated_at = datetime('now')
    WHERE id = @id
  `).run(params);
  return getReceipt(id);
}

export function deleteReceipt(id) {
  return db().prepare('DELETE FROM expense_receipts WHERE id = ?').run(id);
}

// ─── Summary ────────────────────────────────────────────────

/**
 * Totals for one project, drafts excluded. Category totals are pre-tax line
 * items; sales tax and any difference between the itemized lines and the
 * receipt total (discounts, rounding, lines not yet entered) get their own
 * rows so every breakdown adds up to the receipt totals.
 */
export function projectSummary(project_id) {
  const receipts = db().prepare(`
    SELECT r.id, r.total_cents, r.tax_cents, r.paid_by, r.status,
           COALESCE((SELECT SUM(amount_cents) FROM expense_items i WHERE i.receipt_id = r.id), 0) AS items_cents
    FROM expense_receipts r
    WHERE r.project_id = ? AND r.status != 'draft'
  `).all(project_id);

  const byCategory = db().prepare(`
    SELECT COALESCE(NULLIF(i.category, ''), 'Uncategorized') AS category, SUM(i.amount_cents) AS cents
    FROM expense_items i
    JOIN expense_receipts r ON r.id = i.receipt_id
    WHERE r.project_id = ? AND r.status != 'draft'
    GROUP BY 1 ORDER BY cents DESC
  `).all(project_id);

  let total = 0, tax = 0, adjustments = 0;
  const byStatus = Object.fromEntries(RECEIPT_STATUSES.filter(s => s !== 'draft').map(s => [s, { count: 0, cents: 0 }]));
  const people = new Map();

  for (const r of receipts) {
    const receiptTotal = r.total_cents ?? (r.items_cents + (r.tax_cents || 0));
    total += receiptTotal;
    tax += r.tax_cents || 0;
    adjustments += receiptTotal - r.items_cents - (r.tax_cents || 0);
    byStatus[r.status].count += 1;
    byStatus[r.status].cents += receiptTotal;

    const who = (r.paid_by || 'Unknown').trim();
    if (!people.has(who)) people.set(who, { paid_by: who, total_cents: 0, owed_cents: 0, reimbursed_cents: 0 });
    const p = people.get(who);
    p.total_cents += receiptTotal;
    if (r.status === 'reimbursed') p.reimbursed_cents += receiptTotal;
    else p.owed_cents += receiptTotal;
  }

  if (tax) byCategory.push({ category: 'Sales tax', cents: tax });
  if (adjustments) byCategory.push({ category: 'Discounts / unitemized', cents: adjustments });

  const drafts = db().prepare(
    "SELECT COUNT(*) AS n FROM expense_receipts WHERE project_id = ? AND status = 'draft'"
  ).get(project_id).n;

  return {
    total_cents: total,
    receipt_count: receipts.length,
    draft_count: drafts,
    by_category: byCategory,
    by_status: byStatus,
    by_person: [...people.values()].sort((a, b) => b.owed_cents - a.owed_cents)
  };
}

/** Every line item (plus a tax line per receipt) for the CSV export. */
export function exportRows(project_id) {
  return db().prepare(`
    SELECT r.id AS receipt_id, r.purchase_date, r.vendor, r.paid_by, r.payment_method, r.status,
           r.reimbursed_on, r.reimbursement_ref, r.total_cents, r.tax_cents, r.notes,
           i.line_no, i.description, i.quantity, i.unit_price_cents, i.amount_cents, i.category
    FROM expense_receipts r
    LEFT JOIN expense_items i ON i.receipt_id = r.id
    WHERE r.project_id = ? AND r.status != 'draft'
    ORDER BY r.purchase_date, r.id, i.line_no
  `).all(project_id);
}
