import { Router } from 'express';
import { getBudgetMonth, getAccounts } from '../ynab/client.js';
import ynabClient from '../ynab/client.js';
import {
  streamChat, generateJSON, getStatus, listModels,
  getActiveModel, setActiveModel,
} from '../services/llm.js';
import { recordCategoryFeedback, getPayeeCategoryMap, normalizePayee } from '../services/db.js';

const router = Router();

const SYSTEM_PROMPT = `You are Marie, a personal finance assistant integrated with the user's YNAB budget. You help them understand their spending, manage their budget, and track financial goals.

HONESTY (most important rule):
- NEVER fabricate, guess, estimate, or invent numbers, accounts, categories, payees, transactions, or dates. Every figure you state must come from a tool result in this conversation.
- Only answer from real tool data. If you have not called a tool that returns the needed data, call it first.
- If the tools return nothing, the data isn't available, or you can't answer, SAY SO plainly (e.g. "I couldn't find any transactions matching that"). Never paper over a gap with a plausible-sounding made-up answer.
- Do not claim an action was taken unless a tool confirms it. It is always better to admit uncertainty than to invent an answer.

ANSWER STYLE (keep it tight):
- Lead with the answer: the number or fact first, context after. No preamble like "Sure!" or "Based on the data...".
- Simple questions get 1-3 sentences. Hard cap: no answer over ~100 words — prefer a table over prose. Never pad an answer.
- When listing 3 or more items (categories, payees, transactions, accounts), use a compact markdown table instead of prose or bullet lists. Right-align nothing; just | Column | Column | rows.
- Format all currency as $X,XXX.XX
- Amounts in YNAB are in milliunits (1000 = $1.00). Always divide by 1000 when presenting to user.
- Negative amounts = outflows (expenses). Positive = inflows (income).
- Don't list more than 10 individual transactions unless asked.
- If a question is ambiguous about date range, default to the current month.

MATH (never compute numbers yourself):
- NEVER add, average, or count transactions yourself — LLM arithmetic is unreliable. Every total, count, or average you state must be copied verbatim from a tool's computed fields.
- For "how much did I spend" (totals, by category, or over time): use get_spending_by_category — its total_spent and by_category/by_month values are computed server-side and match YNAB (refunds are netted).
- Use query_transactions only to LIST individual transactions. Its count/total_outflow/total_inflow/net fields are computed over ALL matches — use those for any summary numbers. If "truncated" is set, the list is incomplete but the totals are still exact; say how many matches there are and show only the listed ones.
- Date ranges: use whole calendar months for "last N months" — start_date is the 1st of the month (N-1) months before the current month, end_date is today. The current month is included but partial; mention that.

ANSWERING "AM I ON TRACK / HOW'S MY BUDGET":
- Call get_budget_status. It returns exact, pre-computed values: ready_to_assign, totals (budgeted/spent/available), overspent_count, and an overspent list with exact over_by amounts.
- Report these numbers EXACTLY as returned — do not recompute, round differently, or estimate. For overspent categories, use the over_by value verbatim.
- Do NOT pull account balances or mention "ready to assign" amounts unless they come from this tool's output. Never invent totals.

ANSWERING ABOUT A SPECIFIC CATEGORY:
- When the user asks about one specific category (e.g. "how much did I spend on dining out?"), call get_spending_by_category with category_search set to that category name (e.g. "dining"). This returns ONLY matching categories.
- Report ONLY the categories that genuinely match what the user asked about. NEVER lump in unrelated categories (e.g. do not add "Maintenance" or "Vacation Fund" to a dining question). If only one category matches, report just that one number.
- If category_search returns matched:false or no results, tell the user you couldn't find that category — do not substitute other categories.

CHARTS:
- Draw a chart when the user asks for one (chart/graph/plot/visualize/pivot/"show me"), AND proactively when the answer is a comparison or breakdown across 3+ items (top categories, spending breakdown, account balances, budget vs actual). For single-number answers, text only.
- Pick the chart type yourself — never ask the user which type they want. If they name a type, use it. Otherwise:
  * share/breakdown of a total ("where did my money go", "spending breakdown") → donut
  * comparing amounts across categories/payees/accounts ("top 5", "budget vs actual") → bar
  * trend over time ("over the last 6 months", "monthly") → line, with group_by="month"
  * "pivot" (categories across months) → pivot, with group_by="month"
- Draw the chart by calling a data tool with its chart_type parameter set (get_spending_by_category, get_budget_status, or get_account_balances). The chart is built automatically from the real tool data — even if you already showed the numbers, call the tool again with chart_type to draw it.
- You cannot create, link to, or embed images. NEVER output markdown image syntax (![...](...)), image URLs, or placeholder image links — they do not work.
- Do NOT repeat the chart's numbers in text — after a chart, add ONE short sentence pointing out the key takeaway.`;

const TOOLS = [
  {
    name: 'query_transactions',
    description: 'Search and filter transactions by date, payee, or category. Returns matching transactions sorted by date descending.',
    input_schema: {
      type: 'object',
      properties: {
        start_date:      { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        end_date:        { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
        payee_search:    { type: 'string', description: 'Partial payee name (case insensitive)' },
        category_search: { type: 'string', description: 'Partial category name (case insensitive)' },
        min_amount:      { type: 'number', description: 'Minimum absolute value in dollars' },
        limit:           { type: 'integer', description: 'Max results to return (default 100)' },
      },
    },
  },
  {
    name: 'get_spending_by_category',
    description: 'Aggregate total spending by category for a date range. Best for "how much did I spend on X" or "show my top expenses". Set chart_type to also draw a chart from the real results.',
    input_schema: {
      type: 'object',
      properties: {
        start_date:      { type: 'string', description: 'Start date YYYY-MM-DD' },
        end_date:        { type: 'string', description: 'End date YYYY-MM-DD' },
        category_search: { type: 'string', description: 'Scope to ONE specific category by partial name (e.g. "dining" for "Dining Out"). Use this whenever the user asks about a particular category — do NOT return all categories.' },
        top_n:           { type: 'integer', description: 'Only return top N categories by spending' },
        group_by:        { type: 'string', enum: ['month'], description: 'Set to "month" for trends over time — returns per-month totals per category. Required for line/pivot charts spanning multiple months.' },
        chart_type:      { type: 'string', enum: ['bar', 'line', 'pie', 'donut', 'pivot'], description: 'If set, draw a chart of the results. bar to compare, pie/donut for share of total, line for a trend over months, pivot for a stacked breakdown of top categories across months (line/pivot need group_by="month").' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_budget_status',
    description: 'Get budget vs actual for all categories in a month — shows budgeted amount, spending activity, and remaining balance. Set chart_type to also draw a budgeted-vs-spent chart from the real results.',
    input_schema: {
      type: 'object',
      properties: {
        month:           { type: 'string', description: 'Month as YYYY-MM-01, e.g. 2025-06-01. Defaults to current month.' },
        category_search: { type: 'string', description: 'Optional filter by category name' },
        chart_type:      { type: 'string', enum: ['bar'], description: 'If set, draw a budgeted-vs-spent bar chart of the results.' },
      },
    },
  },
  {
    name: 'get_account_balances',
    description: 'Get current balances for all bank/credit card accounts in the budget. Set chart_type to also draw a chart from the real balances.',
    input_schema: {
      type: 'object',
      properties: {
        chart_type: { type: 'string', enum: ['bar', 'pie', 'donut'], description: 'If set, draw a chart of account balances.' },
      },
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

async function fetchTransactionsSince(budgetId, sinceDate) {
  const res = await ynabClient.get(`/budgets/${budgetId}/transactions`, {
    params: { since_date: sinceDate },
  });
  return res.data.data.transactions;
}

async function executeTool(name, input = {}, budgetId) {
  const today = new Date();

  if (name === 'query_transactions') {
    const since = input.start_date
      ? new Date(new Date(input.start_date).getTime() - 86400000).toISOString().slice(0, 10)
      : new Date(today.getFullYear() - 1, today.getMonth(), 1).toISOString().slice(0, 10);

    let txns = await fetchTransactionsSince(budgetId, since);
    txns = txns.filter(t => !t.deleted && !t.transfer_account_id);

    if (input.start_date)      txns = txns.filter(t => t.date >= input.start_date);
    if (input.end_date)        txns = txns.filter(t => t.date <= input.end_date);
    if (input.payee_search)    txns = txns.filter(t => t.payee_name?.toLowerCase().includes(input.payee_search.toLowerCase()));
    if (input.category_search) txns = txns.filter(t => t.category_name?.toLowerCase().includes(input.category_search.toLowerCase()));
    if (input.min_amount)      txns = txns.filter(t => Math.abs(t.amount / 1000) >= input.min_amount);

    // Totals are computed over the FULL match set BEFORE truncating the list,
    // so the model reports exact numbers even when it only sees recent rows.
    const totalOutflow = txns.filter(t => t.amount < 0).reduce((s, t) => s - t.amount / 1000, 0);
    const totalInflow  = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount / 1000, 0);
    const count = txns.length;
    const limit = input.limit ?? 100;

    const list = txns.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);

    return {
      count,
      total_outflow: totalOutflow.toFixed(2),
      total_inflow:  totalInflow.toFixed(2),
      net:           (totalInflow - totalOutflow).toFixed(2),
      truncated:     count > limit ? `list shows the newest ${limit} of ${count} matches — totals above cover ALL ${count}` : false,
      transactions: list.map(t => ({
        date:           t.date,
        payee:          t.payee_name,
        category:       t.category_name,
        amount_dollars: (t.amount / 1000).toFixed(2),
        memo:           t.memo || null,
        cleared:        t.cleared,
      })),
    };
  }

  if (name === 'get_spending_by_category') {
    // Default to the current month if the model omits the range.
    const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0).toLocaleDateString('en-CA');
    let startDate    = input.start_date || monthStart;
    const endDate    = input.end_date   || monthEnd;

    // Month-grouped results must start on a month boundary or the first bar is
    // silently a partial month (e.g. "last 6 months" starting Jan 4 undercounts January).
    if (input.group_by === 'month') startDate = `${startDate.slice(0, 7)}-01`;

    // Spending matches YNAB category activity: outflows PLUS refunds netted in.
    // (A positive transaction in a real category is a refund, not income.)
    const isIncome = (t) => t.amount > 0 && (!t.category_id || (t.category_name || '').startsWith('Inflow'));

    const txns = await fetchTransactionsSince(budgetId, startDate);
    let filtered = txns.filter(t =>
      !t.deleted && !t.transfer_account_id && !isIncome(t) &&
      t.date >= startDate && t.date <= endDate
    );

    // Scope to a specific category when asked (e.g. "dining out") so we never
    // lump unrelated categories into the answer.
    if (input.category_search) {
      const q = input.category_search.toLowerCase();
      filtered = filtered.filter(t => t.category_name?.toLowerCase().includes(q));
      if (filtered.length === 0) {
        return { matched: false, category_search: input.category_search, total_spent: '0.00', by_category: [] };
      }
    }

    // Month-grouped mode: per-month totals per category, for trends/pivots.
    if (input.group_by === 'month') {
      const catTotals = {};
      for (const t of filtered) {
        const cat = t.category_name || 'Uncategorized';
        catTotals[cat] = (catTotals[cat] || 0) - t.amount / 1000; // refunds net out
      }
      // Keep the pivot readable: top N categories (default 6), rest as "Other".
      const topCats = Object.entries(catTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, input.top_n ?? 6)
        .map(([name]) => name);
      const topSet = new Set(topCats);

      const byMonth = {};
      for (const t of filtered) {
        const month = t.date.slice(0, 7);
        const cat   = t.category_name || 'Uncategorized';
        const key   = topSet.has(cat) ? cat : 'Other';
        (byMonth[month] ||= {})[key] = (byMonth[month][key] || 0) - t.amount / 1000; // refunds net out
      }

      const months = Object.keys(byMonth).sort().map(month => {
        const row = { month };
        for (const cat of topCats) row[cat] = Math.round((byMonth[month][cat] || 0) * 100) / 100;
        if (byMonth[month].Other) row.Other = Math.round(byMonth[month].Other * 100) / 100;
        row.total = Math.round(Object.values(byMonth[month]).reduce((s, v) => s + v, 0) * 100) / 100;
        return row;
      });

      return {
        group_by: 'month',
        start_date: startDate,
        end_date: endDate,
        note: 'Whole calendar months; refunds netted against their category (matches YNAB activity).',
        transaction_count: filtered.length,
        total_spent: filtered.reduce((s, t) => s - t.amount / 1000, 0).toFixed(2),
        categories: topCats,
        by_month: months,
      };
    }

    const byCategory = {};
    for (const t of filtered) {
      const cat = t.category_name || 'Uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) - t.amount / 1000; // refunds net out
    }

    let sorted = Object.entries(byCategory)
      .map(([category, total]) => ({ category, total_spent: total.toFixed(2) }))
      .sort((a, b) => parseFloat(b.total_spent) - parseFloat(a.total_spent));
    if (input.top_n) sorted = sorted.slice(0, input.top_n);

    return {
      start_date: startDate,
      end_date: endDate,
      transaction_count: filtered.length,
      total_spent: filtered.reduce((s, t) => s - t.amount / 1000, 0).toFixed(2),
      matched_categories: sorted.map(s => s.category),
      by_category: sorted,
    };
  }

  if (name === 'get_budget_status') {
    const month = input.month || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const monthData = await getBudgetMonth(budgetId, month);
    let cats = (monthData.categories || []).filter(c => !c.deleted && !c.hidden && (c.budgeted !== 0 || c.activity !== 0));
    if (input.category_search) {
      const q = input.category_search.toLowerCase();
      cats = cats.filter(c => c.name?.toLowerCase().includes(q));
    }

    const categories = cats.map(c => ({
      group:     c.category_group_name,
      name:      c.name,
      budgeted:  (c.budgeted / 1000).toFixed(2),
      spent:     (Math.abs(Math.min(c.activity, 0)) / 1000).toFixed(2),
      balance:   (c.balance / 1000).toFixed(2),
      overspent: c.balance < 0,
    }));

    // Pre-computed accurate aggregates so the model reports rather than invents.
    const overspent = cats
      .filter(c => c.balance < 0)
      .map(c => ({ name: c.name, over_by: (Math.abs(c.balance) / 1000).toFixed(2) }))
      .sort((a, b) => parseFloat(b.over_by) - parseFloat(a.over_by));

    const sum = (sel) => cats.reduce((s, c) => s + sel(c), 0);

    return {
      month,
      ready_to_assign: ((monthData.to_be_budgeted || 0) / 1000).toFixed(2),
      totals: {
        budgeted:  (sum(c => c.budgeted) / 1000).toFixed(2),
        spent:     (Math.abs(sum(c => Math.min(c.activity, 0))) / 1000).toFixed(2),
        available: (sum(c => c.balance) / 1000).toFixed(2),
      },
      overspent_count: overspent.length,
      overspent,           // exact "over_by" amounts — use these verbatim
      categories,
    };
  }

  if (name === 'get_account_balances') {
    const accounts = await getAccounts(budgetId);
    return accounts
      .filter(a => !a.deleted && !a.closed && a.on_budget)
      .map(a => ({ name: a.name, type: a.type, balance: (a.balance / 1000).toFixed(2) }));
  }

  return { error: `Unknown tool: ${name}` };
}

// Build a chart spec from a tool's REAL result data (model never supplies data).
function buildChartSpec(toolName, args, result) {
  const chart_type = args.chart_type;
  if (!chart_type) return null;

  // Month-grouped spending → line (trend) or stacked bar (pivot) across months.
  if (toolName === 'get_spending_by_category' && result?.group_by === 'month' && result.by_month?.length) {
    const yKeys = [...result.categories, ...(result.by_month.some(r => r.Other) ? ['Other'] : [])];
    const type  = chart_type === 'line' ? 'line' : 'pivot';
    return { chart_type: type, title: 'Spending by Month', data: result.by_month, x_key: 'month', y_keys: yKeys };
  }

  if (toolName === 'get_spending_by_category' && result?.by_category?.length) {
    let data = result.by_category.map(r => ({ category: r.category, amount: parseFloat(r.total_spent) }));
    // Netting refunds can leave a category negative — meaningless as a pie slice.
    if (chart_type === 'pie' || chart_type === 'donut') data = data.filter(r => r.amount > 0);
    // Pie/donut become unreadable with many slices — keep top 8, group the rest.
    if ((chart_type === 'pie' || chart_type === 'donut') && data.length > 9) {
      const top  = data.slice(0, 8);
      const rest = data.slice(8).reduce((s, r) => s + r.amount, 0);
      data = [...top, { category: 'Other', amount: Math.round(rest * 100) / 100 }];
    }
    return { chart_type, title: 'Spending by Category', data, x_key: 'category', y_keys: ['amount'], name_key: 'category', value_key: 'amount' };
  }

  if (toolName === 'get_budget_status' && Array.isArray(result?.categories) && result.categories.length) {
    const data = result.categories
      .filter(c => parseFloat(c.budgeted) > 0 || parseFloat(c.spent) > 0)
      .map(c => ({ category: c.name, budgeted: parseFloat(c.budgeted), spent: parseFloat(c.spent) }));
    return { chart_type: 'bar', title: 'Budgeted vs Spent', data, x_key: 'category', y_keys: ['budgeted', 'spent'] };
  }

  if (toolName === 'get_account_balances' && Array.isArray(result) && result.length) {
    const data = result.map(a => ({ account: a.name, balance: parseFloat(a.balance) }));
    return { chart_type, title: 'Account Balances', data, x_key: 'account', y_keys: ['balance'], name_key: 'account', value_key: 'balance' };
  }

  return null;
}

// Strip ```json fences and grab the first JSON array/object.
function extractJSON(text, fallback) {
  if (!text) return fallback;
  const cleaned = text.replace(/```json|```/g, '').trim();
  const match = cleaned.match(/[[{][\s\S]*[\]}]/);
  try { return JSON.parse(match ? match[0] : cleaned); } catch { return fallback; }
}

// Detect recurring subscriptions from a window of transactions (outflows).
// Heuristic: same payee, charged in 2+ distinct months, with a consistent amount.
function detectSubscriptions(txns) {
  const byPayee = {};
  for (const t of txns) {
    if (t.amount >= 0) continue;
    const p = (t.payee_name || '').trim();
    if (!p) continue;
    (byPayee[p] ||= []).push({ date: t.date, amount: Math.abs(t.amount / 1000), month: t.date.slice(0, 7) });
  }

  const subs = [];
  for (const [payee, listRaw] of Object.entries(byPayee)) {
    const list = listRaw.sort((a, b) => a.date.localeCompare(b.date));
    if (list.length < 2) continue;
    if (new Set(list.map(x => x.month)).size < 2) continue; // must recur across months

    const amounts = list.map(x => x.amount).sort((a, b) => a - b);
    const median  = amounts[Math.floor(amounts.length / 2)];

    // Subscriptions bill a near-IDENTICAL amount each cycle (within 1% or $0.50).
    // Tight tolerance keeps out groceries/variable spend at the same payee.
    const near = list.filter(x => Math.abs(x.amount - median) <= Math.max(0.5, median * 0.01));
    if (near.length < 2) continue;
    // The recurring amount must dominate (most charges at this payee are the same).
    if (near.length / list.length < 0.6) continue;
    // Filter out large fixed bills (mortgage/rent/loans) — not "subscriptions to review".
    if (median > 300) continue;

    // Price increase: earliest vs latest "near" charge differs meaningfully
    const first = near[0], last = near[near.length - 1];
    const price_increase = last.amount - first.amount > 0.5
      ? { from: first.amount.toFixed(2), to: last.amount.toFixed(2) }
      : null;

    subs.push({ payee, monthly: median.toFixed(2), occurrences: near.length, price_increase });
  }

  subs.sort((a, b) => parseFloat(b.monthly) - parseFloat(a.monthly));
  return {
    count: subs.length,
    total_monthly: subs.reduce((s, x) => s + parseFloat(x.monthly), 0).toFixed(2),
    items: subs.slice(0, 12),
    price_increases: subs.filter(s => s.price_increase),
  };
}

// ── Chat (SSE streaming with agentic tool loop, Ollama-native messages) ───────

router.post('/chat', async (req, res) => {
  const { messages, budgetId } = req.body;

  const status = await getStatus();
  if (!status.configured) {
    return res.status(503).json({
      error: status.provider === 'ollama'
        ? `Ollama not reachable at ${status.host}. Is it running? (brew services start ollama)`
        : 'ANTHROPIC_API_KEY not configured.',
    });
  }
  if (!budgetId) return res.status(400).json({ error: 'budgetId required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  // When the client aborts (stop button, closed tab), cancel the in-flight
  // Ollama request too — otherwise the model keeps generating for nothing.
  const aborter = new AbortController();
  res.on('close', () => aborter.abort());

  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const system = `${SYSTEM_PROMPT}\n\nToday is ${today}.`;

    // Convert incoming {role, content} history to Ollama-native format
    const convo = messages.map(m => ({ role: m.role, content: m.content }));

    for (let i = 0; i < 6; i++) {
      if (aborter.signal.aborted) break;

      const { content, toolCalls } = await streamChat({
        system,
        messages: convo,
        tools: TOOLS,
        onText: (text) => send({ type: 'text', content: text }),
        signal: aborter.signal,
      });

      if (!toolCalls.length || aborter.signal.aborted) break;

      const statusLabel = (t) =>
        t.arguments?.chart_type ? 'drawing chart' : (t.name || '').replace(/_/g, ' ');
      send({ type: 'tool_status', content: toolCalls.map(statusLabel).join(', ') });

      // Record the assistant's tool-call turn
      convo.push({
        role: 'assistant',
        content,
        tool_calls: toolCalls.map(t => ({ function: { name: t.name, arguments: t.arguments } })),
      });

      // Execute tools and append results as 'tool' messages
      for (const call of toolCalls) {
        let result;
        try {
          result = await executeTool(call.name, call.arguments, budgetId);
        } catch (err) {
          result = { error: err.message };
        }

        // If a chart was requested, build it from the REAL result data server-side
        // (the model never supplies chart numbers — avoids hallucinated charts).
        if (call.arguments?.chart_type) {
          const spec = buildChartSpec(call.name, call.arguments, result);
          if (spec) {
            send({ type: 'chart', spec });
            // Tell the model the chart is already on screen, or it will try to
            // "draw" one itself (fake image markdown, re-listing every number).
            result = {
              ...(Array.isArray(result) ? { data: result } : result),
              chart_rendered: `A ${spec.chart_type} chart of this data is already displayed to the user. Do NOT output a chart, image, or the full data again — reply with one short takeaway sentence.`,
            };
          }
        }

        convo.push({ role: 'tool', content: JSON.stringify(result) });
      }
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    // Client-initiated abort is not an error — just close quietly.
    if (err.name !== 'AbortError') send({ type: 'error', content: err.message });
    res.end();
  }
});

// ── Auto-categorize ───────────────────────────────────────────────────────────

// Income (an inflow with no category, or already in "Inflow: Ready to Assign")
// doesn't get a spending category in YNAB — keep it out of auto-categorize.
const isIncomeTxn = (t) =>
  t.amount > 0 && (!t.category_id || (t.category_name || '').startsWith('Inflow'));

router.post('/categorize', async (req, res) => {
  const { transactions: allTxns, categories } = req.body;

  try {
    const transactions = (allTxns || []).filter(t => !isIncomeTxn(t));
    if (!transactions.length) return res.json({ suggestions: [] });

    const catById = new Map(categories.map((c, i) => [c.id, { ...c, index: i }]));

    // First pass: learned payee → category history from previously approved
    // suggestions. Exact payee matches skip the LLM entirely — deterministic,
    // instant, and gets stronger every time the user approves.
    const learned = getPayeeCategoryMap();
    const suggestions = [];
    const needsLLM = [];
    for (const t of transactions) {
      const hit = learned[normalizePayee(t.payee_name)];
      if (hit && catById.has(hit.chosen_category_id)) {
        suggestions.push({
          transaction_id: t.id,
          category_id:    hit.chosen_category_id,
          confidence:     'high',
          source:         'history',
          reason:         `You've categorized "${t.payee_name}" as ${hit.chosen_category_name || 'this'} ${hit.n} time${hit.n !== 1 ? 's' : ''} before.`,
        });
      } else {
        needsLLM.push(t);
      }
    }

    if (needsLLM.length) {
      const status = await getStatus();
      if (!status.configured) {
        // Still return the history-based matches even when the LLM is down.
        if (suggestions.length) return res.json({ suggestions, llm_skipped: true });
        return res.status(503).json({ error: `LLM not available (${status.provider})` });
      }

      // Index-based matching: small local models mangle UUIDs, so the model picks
      // numbers and we map them back to real ids server-side. Also ~70% fewer
      // prompt tokens than sending UUIDs.
      const catList = categories.map((c, i) => `${i}: ${c.groupName} → ${c.name}`).join('\n');
      const txnList = needsLLM
        .map((t, i) => `${i}: payee="${t.payee_name}" amount=${(t.amount / 1000).toFixed(2)}${t.memo ? ` memo="${t.memo}"` : ''}`)
        .join('\n');

      // Few-shot steering: recent learned mappings help the model with payees
      // that are similar-but-not-identical to ones the user already categorized.
      const examples = Object.values(learned)
        .filter(h => catById.has(h.chosen_category_id))
        .sort((a, b) => b.last_used.localeCompare(a.last_used))
        .slice(0, 20)
        .map(h => `"${h.payee_name}" → ${catById.get(h.chosen_category_id).index} (${h.chosen_category_name})`)
        .join('\n');

      const raw = await generateJSON({
        system: 'You are a YNAB budget assistant that returns only valid JSON.',
        prompt: `Match each transaction to the best category.

Categories (index: group → name):
${catList}
${examples ? `\nHow this user has categorized payees before (payee → category index) — follow these patterns for similar payees:\n${examples}\n` : ''}
Transactions (index: details):
${txnList}

Respond with a JSON object of this exact shape:
{"suggestions":[{"t":<transaction index>,"c":<category index>,"confidence":"high|medium|low","reason":"brief reason"}]}

Suggest a category for EVERY transaction — use "low" confidence when unsure rather than skipping.`,
      });

      const parsed = extractJSON(raw, { suggestions: [] });
      const rawSuggestions = Array.isArray(parsed) ? parsed : (parsed.suggestions ?? []);

      // Map indices back to real ids; drop anything out of range so a bad pick
      // can never point at a category that doesn't exist.
      for (const s of rawSuggestions) {
        const txn = needsLLM[s.t ?? s.transaction_index];
        const cat = categories[s.c ?? s.category_index];
        if (!txn || !cat) continue;
        suggestions.push({
          transaction_id: txn.id,
          category_id:    cat.id,
          confidence:     ['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'low',
          source:         'llm',
          reason:         s.reason || '',
        });
      }
    }

    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record what the user actually approved for each suggestion (accepted as-is or
// overridden with a different category). This history drives the exact-match
// pass and the few-shot examples above — approving IS the training signal.
router.post('/categorize/feedback', (req, res) => {
  try {
    const { feedback } = req.body;
    if (!Array.isArray(feedback)) return res.status(400).json({ error: 'feedback array required' });
    const recorded = recordCategoryFeedback(feedback);
    res.json({ recorded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Insights ──────────────────────────────────────────────────────────────────

// Insights are computed deterministically from real budget data — no LLM
// involved, so they work (instantly) even when the model server is down.
router.get('/insights', async (req, res) => {
  const { budgetId } = req.query;
  if (!budgetId) return res.status(400).json({ error: 'budgetId required' });

  try {
    const pad   = (n) => String(n).padStart(2, '0');
    const today = new Date();

    // Selected month via ?month=YYYY-MM (or YYYY-MM-01); defaults to current.
    const qMonth = (req.query.month || '').slice(0, 7);
    const [refYear, refMonth] = /^\d{4}-\d{2}$/.test(qMonth)
      ? qMonth.split('-').map(Number)
      : [today.getFullYear(), today.getMonth() + 1];

    const monthStr    = `${refYear}-${pad(refMonth)}-01`;
    const daysInMonth = new Date(refYear, refMonth, 0).getDate();
    const monthEnd    = `${refYear}-${pad(refMonth)}-${pad(daysInMonth)}`;
    const isCurrentMonth = refYear === today.getFullYear() && refMonth === today.getMonth() + 1;
    // Past months are complete — treat every day as elapsed (no projections).
    const dayOfMonth  = isCurrentMonth ? today.getDate() : daysInMonth;

    // Previous month, compared only THROUGH the same day-of-month for a fair
    // pace comparison (full month vs full month when viewing a past month).
    const lm           = new Date(refYear, refMonth - 2, 1);
    const lmDays       = new Date(lm.getFullYear(), lm.getMonth() + 1, 0).getDate();
    const lastMonthStr = `${lm.getFullYear()}-${pad(lm.getMonth() + 1)}-01`;
    const lastMonthCut = `${lm.getFullYear()}-${pad(lm.getMonth() + 1)}-${pad(Math.min(dayOfMonth, lmDays))}`;

    // One fetch window (~95 days ending at the selected month) covers the
    // month, the previous month, and the subscription-detection window.
    const since = new Date(refYear, refMonth - 1, daysInMonth);
    since.setDate(since.getDate() - 95);
    const [monthData, allTxns] = await Promise.all([
      getBudgetMonth(budgetId, monthStr),
      fetchTransactionsSince(budgetId, since.toLocaleDateString('en-CA')),
    ]);

    // Cap at month end so a past month never includes later activity.
    const clean = allTxns.filter(t => !t.deleted && !t.transfer_account_id && t.date <= monthEnd);

    // Income = inflows to "Inflow: Ready to Assign" (or uncategorized inflows).
    // Positive transactions in a REAL category are refunds — they NET against
    // that category's spending (matches YNAB activity), they are not income.
    const isIncome = (t) => t.amount > 0 && (!t.category_id || (t.category_name || '').startsWith('Inflow'));

    const thisMonthTxns = clean.filter(t => t.date >= monthStr);
    const thisIn   = thisMonthTxns.filter(isIncome);
    const thisOut  = thisMonthTxns.filter(t => !isIncome(t));  // outflows + refunds
    const lastOut  = clean.filter(t => !isIncome(t) && t.date >= lastMonthStr && t.date <= lastMonthCut);

    const cats = (monthData.categories || []).filter(c => !c.deleted && !c.hidden);

    // ── Spend pace, overspent, top categories ──
    const overspent  = cats.filter(c => c.balance < 0).map(c => ({ name: c.name, by: (Math.abs(c.balance) / 1000).toFixed(2) }));
    const totalSpent = thisOut.reduce((s, t) => s - t.amount / 1000, 0); // refunds reduce spending
    const groupSpend = (list) => {
      const m = {};
      for (const t of list) { const c = t.category_name || 'Uncategorized'; m[c] = (m[c] || 0) - t.amount / 1000; }
      return m;
    };
    const catThis = groupSpend(thisOut);
    const catLast = groupSpend(lastOut);
    const txnCountByCat = {};
    for (const t of thisOut) {
      const c = t.category_name || 'Uncategorized';
      txnCountByCat[c] = (txnCountByCat[c] || 0) + 1;
    }
    const topCategories = Object.entries(catThis).filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, spent]) => ({ name, spent: spent.toFixed(2) }));
    const dailyAvg     = (totalSpent / dayOfMonth).toFixed(2);
    const projectedEnd = (parseFloat(dailyAvg) * daysInMonth).toFixed(2);

    // ── 1. Month-over-month trends (same period last month) ──
    const trends = Object.keys(catThis)
      .filter(name => catThis[name] >= 20)
      .map(name => {
        const now = catThis[name], prev = catLast[name] || 0;
        return { name, this_period: now.toFixed(2), last_period: prev.toFixed(2),
          pct_change: prev > 0 ? Math.round(((now - prev) / prev) * 100) : null, // null = new this month
          delta: (now - prev).toFixed(2) };
      })
      .sort((a, b) => Math.abs(parseFloat(b.delta)) - Math.abs(parseFloat(a.delta)))
      .slice(0, 8);

    // ── 2. Cash flow & savings rate ──
    const inflow      = thisIn.reduce((s, t) => s + t.amount / 1000, 0);
    const net         = inflow - totalSpent;
    const savingsRate = inflow > 0 ? Math.round((net / inflow) * 100) : null;
    const cashFlow    = { income: inflow.toFixed(2), spending: totalSpent.toFixed(2), net: net.toFixed(2), savings_rate_pct: savingsRate };

    // ── 3. Projected overspends (not yet over, but on pace to exceed) ──
    // Only project categories with 3+ transactions this month — a linear pace is
    // meaningless for lumpy one-shot bills (a mortgage paid on the 1st is not
    // "on pace" to be paid 31 times).
    const projectedOverspends = cats.map(c => {
      const budgeted = c.budgeted / 1000;
      const spent    = Math.abs(Math.min(c.activity, 0)) / 1000;
      if (budgeted <= 0 || c.balance < 0) return null;          // skip unbudgeted / already over
      if ((txnCountByCat[c.name] || 0) < 3) return null;        // skip lumpy categories
      const proj = (spent / dayOfMonth) * daysInMonth;
      if (proj <= budgeted) return null;
      return { name: c.name, budgeted: budgeted.toFixed(2), spent_so_far: spent.toFixed(2), projected: proj.toFixed(2), over_by: (proj - budgeted).toFixed(2) };
    }).filter(Boolean).sort((a, b) => parseFloat(b.over_by) - parseFloat(a.over_by)).slice(0, 5);

    // ── 4. Recurring subscriptions (from the 95-day window) ──
    const subscriptions = detectSubscriptions(clean);

    // ── Build insights deterministically ─────────────────────────────────────
    // Every number is computed here from real data, and every insight carries
    // the breakdown + transactions that produced it. No LLM in this path — the
    // numbers can't be garbled, and it's instant and token-free.

    // Slim transaction shape for drill-downs (id needed for stable React keys)
    const slim = (t) => ({
      id: t.id, date: t.date, payee: t.payee_name, category: t.category_name,
      amount: (t.amount / 1000).toFixed(2), memo: t.memo || null,
    });

    const fmt$ = (n) => `$${Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const txnsIn = (catName) => thisOut
      .filter(t => (t.category_name || 'Uncategorized') === catName)
      .sort((a, b) => a.amount - b.amount)   // biggest outflows first
      .map(slim);

    const insights = [];

    // 1. Overspent categories (or the good news that there are none)
    if (overspent.length) {
      insights.push({
        type: 'warning',
        title: `${overspent.length} categor${overspent.length === 1 ? 'y' : 'ies'} overspent`,
        body: overspent.slice(0, 3).map(o => `${o.name} is over by ${fmt$(o.by)}`).join('; ')
          + (overspent.length > 3 ? ` — and ${overspent.length - 3} more.` : '.'),
        details: {
          note: 'Overspent = the category\'s YNAB balance for the month is below zero. "Over by" is that exact balance. Transactions below are this month\'s activity in the overspent categories.',
          breakdown: overspent.map(o => ({ label: o.name, amount: `-${fmt$(o.by)}` })),
          transactions: overspent.flatMap(o => txnsIn(o.name)).slice(0, 15),
        },
      });
    } else {
      insights.push({
        type: 'positive',
        title: 'No overspent categories',
        body: 'Every category is within its budgeted amount so far this month.',
        details: { note: 'Checked the YNAB month balance of every visible category — none are below zero.' },
      });
    }

    // 2. Projected overspends (smooth categories on pace to exceed budget) —
    // only meaningful mid-month; a past month's outcome is already known.
    if (isCurrentMonth && projectedOverspends.length) {
      const p = projectedOverspends[0];
      insights.push({
        type: 'warning',
        title: `${projectedOverspends.length} categor${projectedOverspends.length === 1 ? 'y' : 'ies'} on pace to overspend`,
        body: `${p.name}: ${fmt$(p.spent_so_far)} spent of ${fmt$(p.budgeted)} budgeted — on pace for ${fmt$(p.projected)} (${fmt$(p.over_by)} over).`,
        details: {
          note: `Projection = spent so far ÷ ${dayOfMonth} days elapsed × ${daysInMonth} days. Only categories with 3+ transactions this month are projected — one-shot bills are excluded.`,
          breakdown: projectedOverspends.map(x => ({ label: `${x.name} (${fmt$(x.spent_so_far)} of ${fmt$(x.budgeted)})`, amount: `→ ${fmt$(x.projected)}` })),
          transactions: projectedOverspends.flatMap(x => txnsIn(x.name)).slice(0, 15),
        },
      });
    }

    // 3. Spending pace (current month) / monthly total (past months)
    insights.push({
      type: 'tip',
      title: isCurrentMonth ? 'Spending pace' : 'Monthly spending',
      body: isCurrentMonth
        ? `${fmt$(totalSpent)} spent in ${dayOfMonth} day${dayOfMonth !== 1 ? 's' : ''} (~${fmt$(dailyAvg)}/day). At this pace the month ends around ${fmt$(projectedEnd)}.`
        : `${fmt$(totalSpent)} spent over ${daysInMonth} days (~${fmt$(dailyAvg)}/day).`,
      details: {
        note: isCurrentMonth
          ? `Pace = total spent ÷ days elapsed. Early in the month, one-time bills (rent, mortgage) inflate the projection — treat it as a ceiling, not a forecast. Refunds are netted against spending.`
          : `Full-month total with refunds netted against spending.`,
        breakdown: topCategories.map(c => ({ label: c.name, amount: fmt$(c.spent) })),
        transactions: [...thisOut].sort((a, b) => a.amount - b.amount).slice(0, 10).map(slim),
      },
    });

    // 4. Month-over-month movers (same day-of-month window for a fair comparison)
    const biggestUp = trends.filter(t => parseFloat(t.delta) > 50 && t.pct_change !== null)[0];
    if (biggestUp) {
      insights.push({
        type: 'warning',
        title: `${biggestUp.name} up ${biggestUp.pct_change}% vs last month`,
        body: `${fmt$(biggestUp.this_period)} ${isCurrentMonth ? `in the first ${dayOfMonth} day${dayOfMonth !== 1 ? 's' : ''}` : 'this month'}, vs ${fmt$(biggestUp.last_period)} in the same period the month before (+${fmt$(biggestUp.delta)}).`,
        details: {
          note: isCurrentMonth
            ? `Compares day 1–${dayOfMonth} of this month against day 1–${dayOfMonth} of last month, so partial months are compared fairly.`
            : `Compares the full selected month against the full month before it.`,
          breakdown: trends.map(t => ({
            label: t.name,
            amount: `${fmt$(t.last_period)} → ${fmt$(t.this_period)}${t.pct_change !== null ? ` (${t.pct_change > 0 ? '+' : ''}${t.pct_change}%)` : ' (new)'}`,
          })),
          transactions: txnsIn(biggestUp.name).slice(0, 10),
        },
      });
    }
    const biggestDown = trends.filter(t => parseFloat(t.delta) < -50)[0];
    if (biggestDown) {
      insights.push({
        type: 'positive',
        title: `${biggestDown.name} down vs last month`,
        body: `${fmt$(biggestDown.this_period)} ${isCurrentMonth ? 'so far' : 'this month'}, vs ${fmt$(biggestDown.last_period)} in the same period the month before (${fmt$(biggestDown.delta)} less).`,
        details: {
          note: isCurrentMonth
            ? `Compares day 1–${dayOfMonth} of this month against the same days last month.`
            : `Compares the full selected month against the full month before it.`,
          transactions: txnsIn(biggestDown.name).slice(0, 10),
        },
      });
    }

    // 5. Cash flow & savings rate
    insights.push({
      type: net >= 0 ? 'positive' : 'warning',
      title: net >= 0 ? `Cash-flow positive: +${fmt$(net)}` : `Spending exceeds income by ${fmt$(net)}`,
      body: inflow > 0
        ? `${fmt$(inflow)} income vs ${fmt$(totalSpent)} spending${savingsRate !== null ? ` — a ${savingsRate}% savings rate` : ''}.`
        : `No income recorded ${isCurrentMonth ? 'yet this month' : 'this month'} against ${fmt$(totalSpent)} of spending.`,
      details: {
        note: 'Income = inflows to "Ready to Assign" only. Refunds (positive transactions in a spending category) net against that category\'s spending instead of counting as income.',
        breakdown: [
          { label: 'Income', amount: fmt$(inflow) },
          { label: 'Spending (net of refunds)', amount: `-${fmt$(totalSpent)}` },
          { label: 'Net', amount: `${net >= 0 ? '+' : '-'}${fmt$(net)}` },
        ],
        transactions: thisIn.map(slim).slice(0, 10),
      },
    });

    // 6. Subscriptions
    if (subscriptions.count) {
      const increases = subscriptions.price_increases;
      insights.push({
        type: increases.length ? 'warning' : 'tip',
        title: increases.length
          ? `${increases.length} subscription price increase${increases.length !== 1 ? 's' : ''}`
          : `${subscriptions.count} recurring charges ≈ ${fmt$(subscriptions.total_monthly)}/mo`,
        body: increases.length
          ? increases.slice(0, 3).map(s => `${s.payee}: ${fmt$(s.price_increase.from)} → ${fmt$(s.price_increase.to)}`).join('; ') + '.'
          : `Detected from repeated same-amount charges over the last ~3 months. Worth a scan for anything you no longer use.`,
        details: {
          note: 'A payee counts as a subscription when it charges a near-identical amount (±1%) in 2+ different months, under $300. "Monthly" is the median charge.',
          breakdown: subscriptions.items.map(s => ({ label: `${s.payee} (${s.occurrences}×)`, amount: `${fmt$(s.monthly)}/mo` })),
          transactions: clean
            .filter(t => t.amount < 0 && subscriptions.items.some(s => s.payee === (t.payee_name || '').trim()))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 15)
            .map(slim),
        },
      });
    }

    res.json({
      insights,
      meta: {
        month: monthStr, isCurrentMonth, totalSpent: totalSpent.toFixed(2), overspentCount: overspent.length,
        projectedEnd, dayOfMonth, daysInMonth,
        net: net.toFixed(2), savingsRate, income: inflow.toFixed(2),
        subscriptionTotal: subscriptions.total_monthly, subscriptionCount: subscriptions.count,
        projectedOverspendCount: projectedOverspends.length,

        // Drill-down sources — every aggregate above is derived from these arrays.
        overspentList:       overspent,                 // [{ name, by }]
        subscriptionsList:   subscriptions.items,       // [{ payee, monthly, occurrences, price_increase }]
        projectedOverspends,                            // [{ name, budgeted, spent_so_far, projected, over_by }]
        topCategories,                                  // [{ name, spent }]
        trends,                                         // [{ name, this_period, last_period, pct_change, delta }]
        expensesList:        thisOut.map(slim).sort((a, b) => b.date.localeCompare(a.date)),
        incomeList:          thisIn.map(slim).sort((a, b) => b.date.localeCompare(a.date)),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Status, model listing, and model switching ────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    res.json(await getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/models', async (req, res) => {
  try {
    res.json({ models: await listModels(), active: getActiveModel() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/model', async (req, res) => {
  try {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model required' });
    const active = setActiveModel(model);
    res.json({ active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', async (req, res) => res.json([]));

export default router;
