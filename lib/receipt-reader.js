/**
 * Receipt reader: sends a receipt photo or PDF to Claude and gets back the
 * vendor, date, totals and line items as structured data. The result only
 * pre-fills the form; a person checks it before the receipt is submitted.
 *
 * Needs ANTHROPIC_API_KEY. Without it, uploads still work and the receipt is
 * entered by hand.
 */

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import sharp from 'sharp';
import fs from 'fs/promises';

const MODEL = 'claude-opus-5-5';

// Formats Claude reads directly. HEIC (iPhone's default) is stored but not read.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PDF_TYPE = 'application/pdf';

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export function readerConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function canRead(mimeType) {
  return IMAGE_TYPES.has(mimeType) || mimeType === PDF_TYPE;
}

function receiptSchema(categories) {
  const money = z.number().nullable();
  return z.object({
    is_receipt: z.boolean().describe('false if the document is not a purchase receipt or invoice'),
    vendor: z.string().nullable().describe('Store name, e.g. "Vashon True Value"'),
    purchase_date: z.string().nullable().describe('Purchase date as YYYY-MM-DD'),
    subtotal: money.describe('Pre-tax subtotal in dollars'),
    tax: money.describe('Sales tax in dollars'),
    total: money.describe('Amount actually charged, in dollars'),
    payment_method: z.string().nullable().describe('e.g. "Visa ending 1234", "Cash"'),
    items: z.array(z.object({
      description: z.string().describe('Plain-English item name, expanding store abbreviations where clear'),
      quantity: z.number().nullable(),
      unit_price: money.describe('Price per unit in dollars'),
      amount: z.number().describe('Line total in dollars after any line discount'),
      category: z.enum(categories)
    })),
    notes: z.string().nullable().describe('Anything unreadable or uncertain the reviewer should check')
  });
}

async function contentBlock(filePath, mimeType) {
  const data = await fs.readFile(filePath);
  if (mimeType === PDF_TYPE) {
    return {
      type: 'document',
      source: { type: 'base64', media_type: PDF_TYPE, data: data.toString('base64') }
    };
  }
  // Phone photos can be large and sideways: apply the EXIF rotation and cap
  // the long edge so the upload stays well under the image size limit while
  // keeping small receipt print legible.
  const jpeg = await sharp(data)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') }
  };
}

const toCents = (dollars) => (dollars === null || dollars === undefined ? null : Math.round(dollars * 100));

/**
 * Read a receipt file. Returns { fields, items, raw } with money in cents,
 * ready for saveReceipt(). Throws on API errors or an unreadable result.
 */
export async function readReceipt(filePath, mimeType, { projectName, categories }) {
  const cats = categories.length ? categories : ['Other'];
  const block = await contentBlock(filePath, mimeType);

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: betaZodOutputFormat(receiptSchema(cats))
    },
    system:
      'You transcribe purchase receipts for a small community water system so a board ' +
      'treasurer can reimburse volunteers. Copy what is printed; never invent a value. ' +
      'Use null for anything you cannot read. List every purchased line item once, ' +
      'skipping subtotal, tax, total, tender and change lines. Fold a coupon or discount ' +
      'line into the item it applies to when that is clear, otherwise leave it out and ' +
      'mention it in notes. Pick the closest category for each item; use "Other" when ' +
      'nothing fits.',
    messages: [{
      role: 'user',
      content: [
        block,
        { type: 'text', text: `This receipt is for the "${projectName}" project. Extract it.` }
      ]
    }]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The receipt reader declined this file. Enter it by hand.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The receipt was too long to read in one pass. Enter it by hand.');
  }
  const out = response.parsed_output;
  if (!out) throw new Error('The receipt reader returned nothing usable.');
  if (!out.is_receipt) throw new Error("This doesn't look like a receipt. Check the file or enter it by hand.");

  const date = out.purchase_date && /^\d{4}-\d{2}-\d{2}$/.test(out.purchase_date) ? out.purchase_date : null;

  return {
    raw: out,
    fields: {
      vendor: out.vendor,
      purchase_date: date,
      subtotal_cents: toCents(out.subtotal),
      tax_cents: toCents(out.tax),
      total_cents: toCents(out.total),
      payment_method: out.payment_method,
      notes: out.notes
    },
    items: out.items.map(i => ({
      description: i.description,
      quantity: i.quantity,
      unit_price_cents: toCents(i.unit_price),
      amount_cents: toCents(i.amount) ?? 0,
      category: cats.includes(i.category) ? i.category : 'Other'
    }))
  };
}
