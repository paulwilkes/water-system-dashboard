/**
 * Project expenses API (mounted behind requireAuth at /api/expenses).
 *
 * Receipts are uploaded as photos or PDFs, read by Claude into a draft, checked
 * and submitted by a board member, then approved and marked reimbursed.
 * Files are kept in <data dir>/receipts, on the Fly volume in production.
 */

import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../../db/database.js';
import * as store from '../../db/expenses.js';
import { readReceipt, readerConfigured, canRead } from '../../lib/receipt-reader.js';

const router = Router();

const RECEIPTS_DIR = process.env.RECEIPTS_DIR || path.join(getDataDir(), 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const MAX_UPLOAD = 15 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD, files: 1 } });

// ── Helpers ──

/** Identify the file from its first bytes rather than trusting the browser. */
function sniff(buf) {
  const hex = buf.subarray(0, 4).toString('hex');
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg' };
  if (hex === '89504e47') return { mime: 'image/png', ext: 'png' };
  if (hex === '47494638') return { mime: 'image/gif', ext: 'gif' };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf.subarray(4, 8).toString() === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(buf.subarray(8, 12).toString())) {
    return { mime: 'image/heic', ext: 'heic' };
  }
  return null;
}

const who = (req) => req.user?.name || req.user?.email || 'unknown';
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isCents = (n) => n === null || (Number.isInteger(n) && Math.abs(n) < 1e10);
const cleanText = (s, max = 500) => (s === null || s === undefined ? null : String(s).trim().slice(0, max) || null);

function idParam(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Bad id' }); return null; }
  return id;
}

function loadReceipt(req, res) {
  const id = idParam(req, res);
  if (!id) return null;
  const receipt = store.getReceipt(id);
  if (!receipt) { res.status(404).json({ error: 'Receipt not found' }); return null; }
  return receipt;
}

/** Read the receipt with Claude and save what it found. Never throws. */
async function extractInto(receipt) {
  if (!readerConfigured()) {
    store.setExtractionResult(receipt.id, { status: 'skipped', error: 'Automatic reading is not set up (no ANTHROPIC_API_KEY). Enter the receipt by hand.' });
    return;
  }
  if (!canRead(receipt.mime_type)) {
    store.setExtractionResult(receipt.id, {
      status: 'skipped',
      error: 'iPhone HEIC photos can\'t be read automatically. Enter it by hand, or set Camera > Formats > Most Compatible.'
    });
    return;
  }
  try {
    const project = store.getProject(receipt.project_id);
    const result = await readReceipt(path.join(RECEIPTS_DIR, receipt.file_name), receipt.mime_type, {
      projectName: project?.name || 'project',
      categories: store.listCategories()
    });
    // Keep anything the person already typed (paid_by is set at upload)
    const fields = Object.fromEntries(Object.entries(result.fields).filter(([k, v]) => v !== null && !receipt[k]));
    store.saveReceipt(receipt.id, fields, receipt.items.length ? undefined : result.items);
    store.setExtractionResult(receipt.id, { status: 'done', json: JSON.stringify(result.raw) });
  } catch (err) {
    console.error(`[expenses] reading receipt ${receipt.id} failed:`, err.message);
    store.setExtractionResult(receipt.id, { status: 'failed', error: err.message.slice(0, 300) });
  }
}

// ── Setup info ──

router.get('/meta', (req, res) => {
  res.json({
    categories: store.listCategories(),
    statuses: store.RECEIPT_STATUSES,
    reader_configured: readerConfigured(),
    me: who(req)
  });
});

router.post('/categories', (req, res) => {
  const name = cleanText(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  res.json({ categories: store.addCategory(name) });
});

// ── Projects ──

router.get('/projects', (req, res) => res.json(store.listProjects()));

function projectFields(body) {
  const out = {};
  if (body.name !== undefined) out.name = cleanText(body.name, 100);
  if (body.description !== undefined) out.description = cleanText(body.description, 1000);
  if (body.budget_cents !== undefined) out.budget_cents = body.budget_cents === null ? null : body.budget_cents;
  if (body.status !== undefined) out.status = body.status;
  return out;
}

router.post('/projects', (req, res) => {
  const fields = projectFields(req.body || {});
  if (!fields.name) return res.status(400).json({ error: 'Project name is required' });
  if (fields.budget_cents !== undefined && !isCents(fields.budget_cents)) return res.status(400).json({ error: 'Bad budget' });
  try {
    res.status(201).json(store.createProject({ ...fields, created_by: who(req) }));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A project with that name already exists' });
    throw err;
  }
});

router.patch('/projects/:id', (req, res) => {
  const id = idParam(req, res);
  if (!id) return;
  if (!store.getProject(id)) return res.status(404).json({ error: 'Project not found' });
  const fields = projectFields(req.body || {});
  if (fields.name === null) return res.status(400).json({ error: 'Project name is required' });
  if (fields.budget_cents !== undefined && !isCents(fields.budget_cents)) return res.status(400).json({ error: 'Bad budget' });
  if (fields.status !== undefined && !['active', 'closed'].includes(fields.status)) return res.status(400).json({ error: 'Bad status' });
  res.json(store.updateProject(id, fields));
});

router.get('/projects/:id/summary', (req, res) => {
  const id = idParam(req, res);
  if (!id) return;
  const project = store.getProject(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project, ...store.projectSummary(id) });
});

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Stop spreadsheet apps from treating a vendor or item name as a formula
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const dollars = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

router.get('/projects/:id/export.csv', (req, res) => {
  const id = idParam(req, res);
  if (!id) return;
  const project = store.getProject(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const header = ['Receipt #', 'Date', 'Vendor', 'Item', 'Qty', 'Unit price', 'Amount', 'Category',
    'Receipt total', 'Paid by', 'Payment method', 'Status', 'Reimbursed on', 'Reimbursement ref', 'Notes'];
  const lines = [header];
  const rows = store.exportRows(id);
  let lastReceipt = null;

  const flushTax = (r) => {
    if (r && r.tax_cents) {
      lines.push([r.receipt_id, r.purchase_date, r.vendor, 'Sales tax', '', '', dollars(r.tax_cents), 'Sales tax',
        dollars(r.total_cents), r.paid_by, r.payment_method, r.status, r.reimbursed_on, r.reimbursement_ref, '']);
    }
  };

  for (const r of rows) {
    if (lastReceipt && lastReceipt.receipt_id !== r.receipt_id) flushTax(lastReceipt);
    lines.push([r.receipt_id, r.purchase_date, r.vendor, r.description ?? '(no line items)', r.quantity,
      dollars(r.unit_price_cents), dollars(r.amount_cents), r.category,
      dollars(r.total_cents), r.paid_by, r.payment_method, r.status, r.reimbursed_on, r.reimbursement_ref,
      lastReceipt?.receipt_id === r.receipt_id ? '' : r.notes]);
    lastReceipt = r;
  }
  flushTax(lastReceipt);

  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-expenses.csv"`);
  res.send('﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n');
});

// ── Receipts ──

router.get('/receipts', (req, res) => {
  const project_id = Number(req.query.project_id);
  if (!Number.isInteger(project_id)) return res.status(400).json({ error: 'project_id is required' });
  const status = req.query.status && store.RECEIPT_STATUSES.includes(req.query.status) ? req.query.status : undefined;
  res.json(store.listReceipts({ project_id, status }));
});

router.get('/receipts/:id', (req, res) => {
  const receipt = loadReceipt(req, res);
  if (receipt) res.json(receipt);
});

/**
 * Upload a receipt file. Creates a draft, reads it with Claude, and returns
 * the draft for review. Reading takes a few seconds; on failure the draft
 * comes back with extraction_error set so it can be typed in.
 */
router.post('/receipts', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is over 15 MB' });
    if (err) return next(err);
    handleUpload(req, res).catch(next);
  });
});

async function handleUpload(req, res) {
  const project_id = Number(req.body?.project_id);
  if (!Number.isInteger(project_id) || !store.getProject(project_id)) {
    return res.status(400).json({ error: 'Pick a project first' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const kind = sniff(req.file.buffer);
  if (!kind) return res.status(415).json({ error: 'Upload a photo (JPEG, PNG, HEIC) or a PDF' });

  const id = store.createReceipt({
    project_id,
    paid_by: cleanText(req.body.paid_by, 100) || who(req),
    original_name: cleanText(req.file.originalname, 200),
    mime_type: kind.mime,
    file_size: req.file.size,
    created_by: who(req)
  });
  const file_name = `${id}-${crypto.randomBytes(6).toString('hex')}.${kind.ext}`;
  fs.writeFileSync(path.join(RECEIPTS_DIR, file_name), req.file.buffer);
  store.setReceiptFile(id, { file_name, mime_type: kind.mime, file_size: req.file.size });

  await extractInto(store.getReceipt(id));
  res.status(201).json(store.getReceipt(id));
}

/** Re-run the reader (e.g. after a failure). Replaces line items only if there are none. */
router.post('/receipts/:id/read', async (req, res, next) => {
  try {
    const receipt = loadReceipt(req, res);
    if (!receipt) return;
    if (!receipt.file_name) return res.status(400).json({ error: 'No file on this receipt' });
    await extractInto(receipt);
    res.json(store.getReceipt(receipt.id));
  } catch (err) { next(err); }
});

router.get('/receipts/:id/file', (req, res) => {
  const receipt = loadReceipt(req, res);
  if (!receipt) return;
  if (!receipt.file_name) return res.status(404).json({ error: 'No file' });
  const filePath = path.join(RECEIPTS_DIR, path.basename(receipt.file_name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Type', receipt.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const download = req.query.download === '1';
  const name = (receipt.original_name || receipt.file_name).replace(/[^\w.\- ]+/g, '_');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name}"`);
  fs.createReadStream(filePath).pipe(res);
});

function receiptFields(body) {
  const out = {};
  const errors = [];
  for (const key of ['vendor', 'paid_by', 'payment_method']) {
    if (body[key] !== undefined) out[key] = cleanText(body[key], 200);
  }
  if (body.notes !== undefined) out.notes = cleanText(body.notes, 2000);
  if (body.purchase_date !== undefined) {
    if (body.purchase_date === null || body.purchase_date === '') out.purchase_date = null;
    else if (isDate(body.purchase_date)) out.purchase_date = body.purchase_date;
    else errors.push('Bad purchase date');
  }
  for (const key of ['subtotal_cents', 'tax_cents', 'total_cents']) {
    if (body[key] !== undefined) {
      if (isCents(body[key])) out[key] = body[key];
      else errors.push(`Bad ${key.replace('_cents', '')}`);
    }
  }
  if (body.project_id !== undefined) {
    if (Number.isInteger(body.project_id) && store.getProject(body.project_id)) out.project_id = body.project_id;
    else errors.push('Bad project');
  }

  let items;
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || body.items.length > 300) errors.push('Bad line items');
    else {
      items = body.items.map(i => ({
        description: cleanText(i?.description, 300) || '',
        quantity: typeof i?.quantity === 'number' && Number.isFinite(i.quantity) ? i.quantity : null,
        unit_price_cents: isCents(i?.unit_price_cents ?? null) ? (i?.unit_price_cents ?? null) : null,
        amount_cents: Number.isInteger(i?.amount_cents) ? i.amount_cents : NaN,
        category: cleanText(i?.category, 60)
      }));
      if (items.some(i => Number.isNaN(i.amount_cents))) errors.push('Every line item needs an amount');
    }
  }
  return { fields: out, items, errors };
}

router.put('/receipts/:id', (req, res) => {
  const receipt = loadReceipt(req, res);
  if (!receipt) return;
  if (receipt.status === 'approved' || receipt.status === 'reimbursed') {
    return res.status(409).json({ error: `This receipt is ${receipt.status}. Move it back to submitted to edit it.` });
  }
  const { fields, items, errors } = receiptFields(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  res.json(store.saveReceipt(receipt.id, fields, items));
});

router.post('/receipts/:id/status', (req, res) => {
  const receipt = loadReceipt(req, res);
  if (!receipt) return;
  const { status, reimbursed_on, reimbursement_ref } = req.body || {};
  if (!store.RECEIPT_STATUSES.includes(status)) return res.status(400).json({ error: 'Bad status' });

  if (status !== 'draft') {
    const missing = [];
    if (!receipt.vendor) missing.push('vendor');
    if (!receipt.purchase_date) missing.push('date');
    if (receipt.total_cents === null) missing.push('total');
    if (!receipt.paid_by) missing.push('paid by');
    if (missing.length) return res.status(400).json({ error: `Fill in ${missing.join(', ')} first` });
  }
  if (status === 'reimbursed' && !isDate(reimbursed_on)) {
    return res.status(400).json({ error: 'Reimbursement date is required' });
  }
  res.json(store.setReceiptStatus(receipt.id, status, {
    by: who(req),
    reimbursed_on,
    reimbursement_ref: cleanText(reimbursement_ref, 100)
  }));
});

router.delete('/receipts/:id', (req, res) => {
  const receipt = loadReceipt(req, res);
  if (!receipt) return;
  if (receipt.status === 'reimbursed') {
    return res.status(409).json({ error: 'Reimbursed receipts are kept for the record. Move it back first to delete it.' });
  }
  store.deleteReceipt(receipt.id);
  if (receipt.file_name) {
    fs.rm(path.join(RECEIPTS_DIR, path.basename(receipt.file_name)), { force: true }, () => {});
  }
  res.json({ ok: true });
});

export default router;
