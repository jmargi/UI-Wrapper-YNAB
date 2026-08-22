import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Stack, Title, Tabs, Card, Text, Badge, Button, Textarea, Group,
  Alert, ScrollArea, Paper, Loader, Select, ActionIcon, Tooltip,
  ThemeIcon, Divider, Box, TextInput, Modal, Table, UnstyledButton, Collapse, rem,
  Checkbox,
} from '@mantine/core';
import {
  IconRobot, IconSend, IconAlertTriangle, IconBulb, IconCircleCheck,
  IconTag, IconRefresh, IconCheck, IconX, IconSparkles, IconKey,
  IconCpu, IconServer, IconChevronDown, IconPlayerStopFilled,
} from '@tabler/icons-react';
import { BarChart, LineChart, AreaChart, PieChart, DonutChart } from '@mantine/charts';
import { notifications } from '@mantine/notifications';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MonthPickerInput } from '@mantine/dates';
import { useYNAB, api } from '../context/YNABContext';
import CategoryPicker from '../components/CategoryPicker';
import usePersistentState from '../utils/usePersistentState';
import { formatCurrency } from '../utils/format';

// Palette for AI-generated charts
const CHART_COLORS = ['teal.6', 'blue.6', 'grape.6', 'orange.6', 'red.6', 'cyan.6', 'lime.6', 'pink.6', 'indigo.6', 'yellow.6'];

// Charts render as real components, never as images. Strip any markdown image
// syntax or bare image links the model might still emit so they don't show as junk.
function cleanAssistantText(text) {
  if (!text) return text;
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')             // ![alt](url)
    .replace(/\bhttps?:\/\/\S+\.(?:png|jpe?g|gif|svg|webp)\S*/gi, '') // bare image URLs
    .replace(/\n{3,}/g, '\n\n');                       // collapse blank lines left behind
}

// ── Suggested prompts ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'How much did I spend this month?',
  'Show me a breakdown of this month’s spending',
  'What are my top 5 expense categories this month?',
  'Am I on track with my budget this month?',
  'Chart my spending by month for the last 6 months',
  'What are my account balances?',
  'Show me my biggest purchases this week',
];

// ── Provider-aware "not ready" alert ──────────────────────────────────────────

function NotReadyAlert({ status }) {
  // Anthropic provider, no key
  if (status?.provider === 'anthropic') {
    return (
      <Alert icon={<IconKey size={16} />} title="API Key Required" color="orange">
        Set <code>ANTHROPIC_API_KEY</code> in <code>backend/.env</code>, then run <code>pm2 restart all</code>.
      </Alert>
    );
  }

  // Ollama provider — distinguish "server down" vs "model not pulled"
  if (status?.provider === 'ollama' && !status?.reachable) {
    return (
      <Alert icon={<IconServer size={16} />} title="Ollama isn't running" color="orange">
        The local model server isn't reachable at <code>{status?.host}</code>.
        <br /><br />
        Start it with <code>brew services start ollama</code>.
      </Alert>
    );
  }
  if (status?.provider === 'ollama' && status?.reachable && status?.hasModel === false) {
    return (
      <Alert icon={<IconCpu size={16} />} title="Model not downloaded yet" color="yellow">
        Ollama is running, but <code>{status?.model}</code> hasn't been pulled.
        <br /><br />
        Run <code>ollama pull {status?.model}</code> in a terminal, then refresh.
      </Alert>
    );
  }

  return (
    <Alert icon={<IconAlertTriangle size={16} />} title="AI not available" color="orange">
      The AI provider isn't configured.
    </Alert>
  );
}

// ── Model switcher (Ollama only) ──────────────────────────────────────────────

function ModelSwitcher({ status, onChanged }) {
  const [models, setModels]   = useState([]);
  const [active, setActive]   = useState(status?.model ?? null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (status?.provider !== 'ollama') return;
    api.get('/agent/models')
      .then(r => { setModels(r.data.models ?? []); setActive(r.data.active); })
      .catch(() => {});
  }, [status?.provider]);

  useEffect(() => { load(); }, [load]);

  if (status?.provider !== 'ollama') return null;

  const handleChange = async (model) => {
    if (!model || model === active) return;
    setLoading(true);
    try {
      const r = await api.post('/agent/model', { model });
      setActive(r.data.active);
      notifications.show({ title: 'Model switched', message: r.data.active, color: 'teal', autoClose: 1500 });
      onChanged?.(r.data.active);
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const data = models.map(m => ({ value: m.name, label: `${m.name}${m.parameter_size ? ` · ${m.parameter_size}` : ''}` }));
  // Ensure the active model shows even if /api/tags hasn't listed it yet
  if (active && !data.some(d => d.value === active)) data.unshift({ value: active, label: active });

  return (
    <Select
      size="xs"
      leftSection={loading ? <Loader size={12} /> : <IconCpu size={14} />}
      value={active}
      onChange={handleChange}
      data={data}
      placeholder="Select model"
      checkIconPosition="right"
      allowDeselect={false}
      style={{ flex: '1 1 160px', minWidth: 0, maxWidth: 260 }}
      nothingFoundMessage="No models pulled — run: ollama pull qwen2.5:7b"
    />
  );
}

// ── AI-generated chart ────────────────────────────────────────────────────────

function AgentChart({ spec }) {
  if (!spec || !Array.isArray(spec.data) || spec.data.length === 0) return null;

  const { chart_type = 'bar', title, data } = spec;

  // Coerce numeric-looking strings to numbers so charts render
  const numericData = data.map(row => {
    const out = { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'string' && out[k].trim() !== '' && !isNaN(Number(out[k]))) out[k] = Number(out[k]);
    }
    return out;
  });

  const money = (v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  const renderInner = () => {
    if (chart_type === 'pie' || chart_type === 'donut') {
      const nameKey  = spec.name_key  || Object.keys(numericData[0]).find(k => typeof numericData[0][k] === 'string') || 'name';
      const valueKey = spec.value_key || Object.keys(numericData[0]).find(k => typeof numericData[0][k] === 'number') || 'value';
      const pieData = numericData.map((row, i) => ({
        name:  String(row[nameKey]),
        value: Number(row[valueKey]) || 0,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
      const Chart = chart_type === 'donut' ? DonutChart : PieChart;
      return (
        <Group align="center" wrap="nowrap" gap="lg">
          <Chart
            data={pieData}
            size={200}
            withTooltip
            tooltipDataSource="segment"
            valueFormatter={money}
            strokeWidth={1}
          />
          {/* Manual legend — Mantine pie/donut has no built-in legend */}
          <Stack gap={4} style={{ minWidth: 0 }}>
            {pieData.map((d) => (
              <Group key={d.name} gap={6} wrap="nowrap">
                <Box style={{ width: 10, height: 10, borderRadius: 2, background: `var(--mantine-color-${d.color.replace('.', '-')})`, flexShrink: 0 }} />
                <Text size="xs" lineClamp={1}>{d.name}</Text>
                <Text size="xs" c="dimmed" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{money(d.value)}</Text>
              </Group>
            ))}
          </Stack>
        </Group>
      );
    }

    // bar / line / area
    const xKey = spec.x_key || Object.keys(numericData[0]).find(k => typeof numericData[0][k] === 'string') || Object.keys(numericData[0])[0];
    let yKeys = spec.y_keys?.length
      ? spec.y_keys
      : Object.keys(numericData[0]).filter(k => k !== xKey && typeof numericData[0][k] === 'number');
    if (!yKeys.length) yKeys = Object.keys(numericData[0]).filter(k => k !== xKey);

    const series = yKeys.map((name, i) => ({ name, color: CHART_COLORS[i % CHART_COLORS.length] }));
    const longLabels = numericData.some(r => String(r[xKey] ?? '').length > 6);
    const common = {
      h: 300,
      data: numericData,
      dataKey: xKey,
      series,
      withLegend: yKeys.length > 1,
      legendProps: { verticalAlign: 'top', height: 30 },
      valueFormatter: money,
      gridAxis: 'xy',
      tickLine: 'y',
      yAxisProps: { width: 64, tickFormatter: money },
      // Angle long category labels so they don't overlap/smoosh
      xAxisProps: longLabels
        ? { angle: -35, textAnchor: 'end', height: 90, interval: 0, tick: { fontSize: 11 } }
        : { interval: 0, tick: { fontSize: 11 } },
    };

    if (chart_type === 'line') return <LineChart {...common} curveType="linear" withDots />;
    if (chart_type === 'area') return <AreaChart {...common} curveType="linear" withGradient />;
    // "pivot" = stacked bar of categories across months
    return <BarChart {...common} type={chart_type === 'pivot' ? 'stacked' : 'default'} />;
  };

  return (
    <Paper withBorder radius="md" p="md" my={4} style={{ width: 540, maxWidth: '100%' }}>
      {title && <Text fw={600} size="sm" mb="md">{title}</Text>}
      {renderInner()}
    </Paper>
  );
}

// ── Assistant markdown ────────────────────────────────────────────────────────
// Renders assistant replies as markdown so tables, bold amounts, and lists from
// the model come out formatted instead of as raw pipes and asterisks.

const MD_COMPONENTS = {
  p:  ({ children }) => <Text size="sm" style={{ margin: '0 0 6px' }}>{children}</Text>,
  ul: ({ children }) => <ul style={{ margin: '0 0 6px', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 6px', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ fontSize: 'var(--mantine-font-size-sm)', marginBottom: 2 }}>{children}</li>,
  code: ({ children }) => (
    <code style={{ background: 'var(--mantine-color-default-hover)', padding: '1px 5px', borderRadius: 4, fontSize: '0.85em' }}>
      {children}
    </code>
  ),
  table: ({ children }) => (
    <Box style={{ overflowX: 'auto', margin: '4px 0 8px' }}>
      <Table striped highlightOnHover withTableBorder fz="sm" style={{ width: 'auto', minWidth: 280 }}>
        {children}
      </Table>
    </Box>
  ),
  thead: ({ children }) => <Table.Thead>{children}</Table.Thead>,
  tbody: ({ children }) => <Table.Tbody>{children}</Table.Tbody>,
  tr:    ({ children }) => <Table.Tr>{children}</Table.Tr>,
  th:    ({ children }) => <Table.Th>{children}</Table.Th>,
  td:    ({ children }) => <Table.Td>{children}</Table.Td>,
  a:     ({ children }) => <>{children}</>, // no external links in answers
  img:   () => null, // charts render as components; never show model-emitted images
};

function AssistantMarkdown({ content }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}

// ── Chat message bubble ───────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  if (msg.role === 'chart') {
    return (
      <Group justify="flex-start" my={2}>
        <AgentChart spec={msg.spec} />
      </Group>
    );
  }

  if (msg.role === 'status') {
    return (
      <Group gap="xs" justify="center" my={4}>
        <Loader size="xs" color="teal" />
        <Text size="xs" c="dimmed" fs="italic">Looking up: {msg.content}</Text>
      </Group>
    );
  }

  const isUser = msg.role === 'user';

  return (
    <Group justify={isUser ? 'flex-end' : 'flex-start'} align="flex-start" gap="xs">
      {!isUser && (
        <ThemeIcon size="md" radius="xl" color="teal" variant="light" mt={2} style={{ flexShrink: 0 }}>
          <IconRobot size={14} />
        </ThemeIcon>
      )}
      <Paper
        p="sm"
        radius="md"
        style={{
          maxWidth: '75%',
          background: isUser ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-default)',
          border: isUser ? 'none' : '1px solid var(--mantine-color-default-border)',
        }}
      >
        {msg.content ? (
          isUser ? (
            <Text size="sm" style={{ whiteSpace: 'pre-wrap', color: 'white' }}>
              {msg.content}
            </Text>
          ) : (
            <Box style={{ color: 'var(--mantine-color-text)' }}>
              <AssistantMarkdown content={cleanAssistantText(msg.content)} />
              {msg.streaming && <Text size="sm" span style={{ opacity: 0.5 }}>▋</Text>}
            </Box>
          )
        ) : (
          <Loader size="xs" color={isUser ? 'white' : 'teal'} />
        )}
      </Paper>
    </Group>
  );
}

// ── Chat tab ──────────────────────────────────────────────────────────────────

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: "Hi, I'm Marie — your finance assistant. Ask me anything about your budget and spending. I can look up transactions, check category balances, summarize expenses, and draw charts. I only use your real YNAB data, and I'll tell you if I can't find something.",
};

// Repair chat state saved while iOS killed the backgrounded app: drop
// transient status bubbles and empty half-streamed replies, finish the rest.
const sanitizeChat = (saved) => {
  if (!Array.isArray(saved) || saved.length === 0) return [WELCOME_MESSAGE];
  return saved
    .filter(m => m.role !== 'status' && !(m.role === 'assistant' && m.streaming && !m.content))
    .map(m => (m.streaming ? { ...m, streaming: false } : m));
};

function ChatTab({ status, budgetId }) {
  const configured = !!status?.configured;
  // Chat survives the app being minimized/killed on iOS — restored from
  // localStorage on relaunch. "New chat" clears it.
  const [messages, setMessages] = usePersistentState('marie-chat-messages', [WELCOME_MESSAGE], sanitizeChat);
  const [input,   setInput]   = usePersistentState('marie-chat-draft', '');
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const viewport = useRef(null);
  const msgIdRef = useRef(0);
  const abortRef = useRef(null);

  const stopStreaming = () => abortRef.current?.abort();

  // Abort any in-flight request if the user navigates away mid-answer.
  useEffect(() => () => abortRef.current?.abort(), []);

  const scrollToBottom = () =>
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' });

  useEffect(() => { scrollToBottom(); }, [messages]);

  const sendMessage = useCallback(async (text) => {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
    setInput('');
    setLoading(true);

    const userMsg = { role: 'user', content: userText };
    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .concat(userMsg);

    const assistantId = ++msgIdRef.current;
    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', streaming: true }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/agent/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          budgetId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Request failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      // The active assistant bubble that text streams into. Tool calls and charts
      // "close" it so any follow-up text starts a fresh bubble below the chart.
      let currentId = assistantId;

      // Drop the active bubble if it never received any text (avoids empty bubbles
      // before a chart / tool result).
      const closeBubble = () => {
        setMessages(prev => {
          const next = prev.filter(m => !(m.id === currentId && m.role === 'assistant' && !m.content));
          return next.map(m => (m.id === currentId ? { ...m, streaming: false } : m));
        });
        currentId = null;
      };

      // Transient "Looking up…" spinners — remove once real output arrives.
      const clearStatuses = () => setMessages(prev => prev.filter(m => m.role !== 'status'));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'text') {
              if (currentId === null) {
                clearStatuses();
                currentId = ++msgIdRef.current;
                const newId = currentId;
                setMessages(prev => [...prev, { id: newId, role: 'assistant', content: data.content, streaming: true }]);
              } else {
                setMessages(prev => prev.map(m =>
                  m.id === currentId ? { ...m, content: m.content + data.content } : m
                ));
              }
            } else if (data.type === 'tool_status') {
              closeBubble();
              clearStatuses();
              setMessages(prev => [...prev, { id: ++msgIdRef.current, role: 'status', content: data.content }]);
            } else if (data.type === 'chart') {
              closeBubble();
              clearStatuses();
              setMessages(prev => [...prev, { id: ++msgIdRef.current, role: 'chart', spec: data.spec }]);
            } else if (data.type === 'done') {
              clearStatuses();
              setMessages(prev => prev.map(m =>
                m.id === currentId ? { ...m, streaming: false } : m
              ));
            } else if (data.type === 'error') {
              setMessages(prev => prev.map(m =>
                m.id === currentId ? { ...m, content: `Error: ${data.content}`, streaming: false } : m
              ));
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // User hit stop — keep whatever streamed in, drop spinners/empty bubbles.
        setMessages(prev => prev
          .filter(m => m.role !== 'status' && !(m.role === 'assistant' && m.streaming && !m.content))
          .map(m => (m.streaming ? { ...m, streaming: false } : m)));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: `Sorry, something went wrong: ${err.message}`, streaming: false } : m
        ));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }, [input, loading, messages, budgetId]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!configured) return <NotReadyAlert status={status} />;

  return (
    <Stack gap="sm" style={{ height: 'calc(100vh - 220px)', display: 'flex', flexDirection: 'column' }}>
      {/* Suggestions — always shown on a fresh chat, toggleable via 💡 after that */}
      {(messages.length <= 1 || showSuggestions) && (
        <Group gap={6} wrap="wrap">
          {SUGGESTIONS.map(s => (
            <Button
              key={s}
              size="xs"
              variant="light"
              color="teal"
              onClick={() => { setShowSuggestions(false); sendMessage(s); }}
            >
              {s}
            </Button>
          ))}
        </Group>
      )}

      {/* Messages */}
      <ScrollArea viewportRef={viewport} style={{ flex: 1 }} offsetScrollbars>
        <Stack gap="md" p="xs">
          {messages.map((msg, i) => (
            <MessageBubble key={msg.id ?? i} msg={msg} />
          ))}
        </Stack>
      </ScrollArea>

      {/* Input */}
      <Paper withBorder p="xs" radius="md">
        <Group gap="xs" align="flex-end">
          {messages.length > 1 && (
            <>
              <Tooltip label="New chat">
                <ActionIcon
                  size="lg"
                  variant="subtle"
                  color="gray"
                  onClick={() => { setMessages([WELCOME_MESSAGE]); setInput(''); setShowSuggestions(false); }}
                  disabled={loading}
                  aria-label="Start a new chat"
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Prompt ideas">
                <ActionIcon
                  size="lg"
                  variant={showSuggestions ? 'light' : 'subtle'}
                  color="teal"
                  onClick={() => setShowSuggestions(v => !v)}
                  aria-label="Show prompt ideas"
                >
                  <IconBulb size={16} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
          <Textarea
            placeholder="Ask about your spending, budget, or accounts…  (Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autosize
            minRows={1}
            maxRows={4}
            style={{ flex: 1 }}
            disabled={loading}
          />
          {loading ? (
            <Tooltip label="Stop answering">
              <ActionIcon
                size="lg"
                color="red"
                variant="filled"
                onClick={stopStreaming}
                aria-label="Stop answering"
              >
                <IconPlayerStopFilled size={14} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <ActionIcon
              size="lg"
              color="teal"
              variant="filled"
              onClick={() => sendMessage()}
              disabled={!input.trim()}
              aria-label="Send message"
            >
              <IconSend size={16} />
            </ActionIcon>
          )}
        </Group>
      </Paper>
    </Stack>
  );
}

// ── Auto-categorize tab ───────────────────────────────────────────────────────

function AutoCategorizeTab({ status }) {
  const configured = !!status?.configured;
  const { transactions, flatCategories, mergeTransactions } = useYNAB();
  // Survive the app being backgrounded/killed on iOS mid-review — AI
  // suggestions are an LLM call you shouldn't have to repeat.
  const [suggestions, setSuggestions] = usePersistentState('marie-cat-suggestions', {}); // txn id → { category_id, confidence, reason }
  const [overrides,   setOverrides]   = usePersistentState('marie-cat-overrides', {});   // txn id → manually chosen category_id
  const [selected,    setSelected]    = useState(new Set());
  const [loading,     setLoading]     = useState(false); // LLM suggesting
  const [approving,   setApproving]   = useState(false); // bulk PATCH in flight

  // Income (an inflow with no category, or in "Inflow: Ready to Assign") never
  // gets a spending category in YNAB — keep it out of this tab entirely.
  const isIncome = (t) =>
    t.amount > 0 && (!t.category_id || (t.category_name || '').startsWith('Inflow'));

  // ALL pending (unapproved) transactions — including ones that already have a
  // category and just need approval.
  const pending = transactions.filter(t => !t.deleted && !t.approved && !t.transfer_account_id && !isIncome(t));
  const needsCategory = pending.filter(t => !t.category_id);

  // The category a row will be approved with: manual override > AI suggestion > existing.
  const effectiveCategoryId = (t) =>
    overrides[t.id] ?? suggestions[t.id]?.category_id ?? t.category_id ?? null;

  const ready = pending.filter(t => effectiveCategoryId(t)); // rows approvable right now

  const fetchSuggestions = async () => {
    if (!needsCategory.length) return;
    setLoading(true);
    try {
      const res = await api.post('/agent/categorize', {
        transactions: needsCategory.slice(0, 50),
        categories:   flatCategories,
      });
      const byId = {};
      for (const s of res.data.suggestions ?? []) byId[s.transaction_id] = s;
      setSuggestions(byId);
      // Pre-select everything that now has a category so "Approve" is one click.
      setSelected(new Set(
        pending.filter(t => overrides[t.id] ?? byId[t.id]?.category_id ?? t.category_id).map(t => t.id)
      ));
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const allReadySelected = ready.length > 0 && ready.every(t => selected.has(t.id));
  const toggleAll = () =>
    setSelected(allReadySelected ? new Set() : new Set(ready.map(t => t.id)));

  // Approve every selected row — category + approved:true — in ONE API call.
  const approveSelected = async () => {
    const rows = pending.filter(t => selected.has(t.id) && effectiveCategoryId(t));
    const payload = rows
      // Send the current memo so the backend appends its "Assigned in Budget App"
      // stamp rather than overwriting an existing memo.
      .map(t => ({ id: t.id, category_id: effectiveCategoryId(t), approved: true, memo: t.memo ?? '' }));
    if (!payload.length) return;

    // What the user approved (accepted vs overridden AI picks) is the training
    // signal — record it so future suggestions learn these payee → category
    // mappings. Fire-and-forget: feedback failure must never block approval.
    const catName = (id) => flatCategories.find(c => c.id === id)?.name ?? null;
    const feedback = rows.map(t => {
      const chosen = effectiveCategoryId(t);
      return {
        transaction_id:        t.id,
        payee_name:            t.payee_name,
        amount:                t.amount / 1000,
        memo:                  t.memo ?? null,
        suggested_category_id: suggestions[t.id]?.category_id ?? null,
        suggested_confidence:  suggestions[t.id]?.confidence ?? null,
        chosen_category_id:    chosen,
        chosen_category_name:  catName(chosen),
        accepted:              !!suggestions[t.id] && suggestions[t.id].category_id === chosen,
      };
    });

    setApproving(true);
    try {
      const res = await api.patch('/transactions/bulk', { transactions: payload });
      mergeTransactions(res.data.transactions); // authoritative server copies
      api.post('/agent/categorize/feedback', { feedback }).catch(() => {});
      // Drop persisted suggestions/overrides for the rows we just approved
      const approvedIds = new Set(rows.map(t => t.id));
      const prune = (obj) => Object.fromEntries(Object.entries(obj).filter(([id]) => !approvedIds.has(id)));
      setSuggestions(prune);
      setOverrides(prune);
      setSelected(new Set());
      notifications.show({
        title: 'Approved',
        message: `${payload.length} transaction${payload.length !== 1 ? 's' : ''} categorized & approved (1 API call)`,
        color: 'teal',
      });
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setApproving(false);
    }
  };

  const confidenceColor = { high: 'teal', medium: 'yellow', low: 'gray' };
  const selectedReadyCount = ready.filter(t => selected.has(t.id)).length;

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <Text fw={600}>Pending transactions</Text>
          <Text size="sm" c="dimmed">
            {pending.length} awaiting approval · {needsCategory.length} without a category
          </Text>
        </Stack>
        <Group>
          <Button
            size="sm"
            variant="default"
            leftSection={loading ? <Loader size="xs" /> : <IconSparkles size={14} />}
            onClick={fetchSuggestions}
            disabled={loading || !needsCategory.length || !configured}
          >
            {loading ? 'Analyzing…' : `Suggest categories (${Math.min(needsCategory.length, 50)})`}
          </Button>
          <Button
            size="sm"
            color="teal"
            leftSection={<IconCheck size={14} />}
            onClick={approveSelected}
            loading={approving}
            disabled={!selectedReadyCount}
          >
            Approve selected ({selectedReadyCount})
          </Button>
        </Group>
      </Group>

      {!configured && needsCategory.length > 0 && <NotReadyAlert status={status} />}

      {!pending.length && (
        <Alert icon={<IconCircleCheck size={16} />} color="teal" title="All caught up!">
          No transactions waiting for approval.
        </Alert>
      )}

      {pending.length > 0 && (
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <Table.ScrollContainer minWidth={640}>
            <Table striped highlightOnHover fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36}>
                    <Checkbox
                      size="xs"
                      checked={allReadySelected}
                      indeterminate={selectedReadyCount > 0 && !allReadySelected}
                      onChange={toggleAll}
                      aria-label="Select all approvable"
                    />
                  </Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Payee</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>Category</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pending.map((t) => {
                  const sug   = suggestions[t.id];
                  const catId = effectiveCategoryId(t);
                  return (
                    <Table.Tr key={t.id}>
                      <Table.Td>
                        <Checkbox
                          size="xs"
                          checked={selected.has(t.id)}
                          disabled={!catId}
                          onChange={() => toggleRow(t.id)}
                          aria-label={`Select ${t.payee_name}`}
                        />
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{t.date}</Table.Td>
                      <Table.Td><Text size="sm" lineClamp={1}>{t.payee_name || '—'}</Text></Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={600} c={t.amount >= 0 ? 'teal' : 'red'} style={{ whiteSpace: 'nowrap' }}>
                          {formatCurrency(t.amount)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <CategoryPicker
                            size="xs"
                            placeholder="Pick category"
                            value={catId}
                            onChange={(v) => setOverrides(prev => ({ ...prev, [t.id]: v }))}
                            categories={flatCategories}
                            clearable={false}
                            style={{ minWidth: 200, flex: 1 }}
                          />
                          {sug && !overrides[t.id] && (
                            <Tooltip
                              label={sug.reason}
                              multiline
                              maw={260}
                              disabled={!sug.reason}
                              events={{ hover: true, focus: true, touch: true }}
                            >
                              <Badge
                                size="xs"
                                color={sug.source === 'history' ? 'blue' : (confidenceColor[sug.confidence] ?? 'gray')}
                                variant="light"
                                style={{ flexShrink: 0, cursor: 'help' }}
                              >
                                {sug.source === 'history' ? 'Learned' : `AI · ${sug.confidence}`}
                              </Badge>
                            </Tooltip>
                          )}
                        </Group>
                        {/* Tooltips need hover — on mobile show the reason inline instead */}
                        {sug?.reason && !overrides[t.id] && (
                          <Text size="xs" c="dimmed" mt={4} lineClamp={2} hiddenFrom="sm">
                            {sug.reason}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  );
}

// ── Insights tab ──────────────────────────────────────────────────────────────

// Drill-down modal — renders the underlying data behind a clicked stat tile.
function InsightDrillModal({ drill, meta, onClose }) {
  if (!drill || !meta) return null;

  const fmt = (n) => `$${Math.abs(parseFloat(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const monthLabel = meta.month
    ? new Date(meta.month + 'T00:00:00').toLocaleString('default', { month: 'long', year: 'numeric' })
    : '';

  const renderTransactionTable = (rows, amountColor) => {
    if (!rows?.length) return <Text c="dimmed" ta="center" py="lg">No transactions.</Text>;
    return (
      <Box style={{ overflowX: 'auto' }}>
        <Table striped highlightOnHover withTableBorder fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Payee</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th ta="right">Amount</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>{t.date}</Table.Td>
                <Table.Td>{t.payee || '—'}</Table.Td>
                <Table.Td>{t.category || '—'}</Table.Td>
                <Table.Td ta="right" fw={600} c={amountColor ?? (parseFloat(t.amount) >= 0 ? 'teal' : 'red')}>
                  {fmt(t.amount)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>
    );
  };

  const content = (() => {
    switch (drill) {
      case 'spent':
        return (
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {meta.expensesList?.length ?? 0} transaction{(meta.expensesList?.length ?? 0) !== 1 ? 's' : ''} netting {fmt(meta.totalSpent)} spent so far this month (refunds shown in green).
            </Text>
            {renderTransactionTable(meta.expensesList)}
          </Stack>
        );
      case 'projected':
        return (
          <Stack gap="sm">
            <Text size="sm">
              You've spent <strong>{fmt(meta.totalSpent)}</strong> over <strong>{meta.dayOfMonth}</strong> days
              (~{fmt((parseFloat(meta.totalSpent) / meta.dayOfMonth).toFixed(2))}/day).
              At that pace the month-end total is <strong>{fmt(meta.projectedEnd)}</strong>.
            </Text>
            {meta.topCategories?.length > 0 && (
              <>
                <Divider my="xs" label="Top categories driving the projection" labelPosition="left" />
                <Box style={{ overflowX: 'auto' }}>
                  <Table striped withTableBorder fz="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Category</Table.Th>
                        <Table.Th ta="right">Spent so far</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {meta.topCategories.map((c) => (
                        <Table.Tr key={c.name}>
                          <Table.Td>{c.name}</Table.Td>
                          <Table.Td ta="right" fw={600}>{fmt(c.spent)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Box>
              </>
            )}
          </Stack>
        );
      case 'net':
      case 'savings': {
        const inc = parseFloat(meta.income);
        const sp  = parseFloat(meta.totalSpent);
        const net = parseFloat(meta.net);
        return (
          <Stack gap="sm">
            <Group justify="space-around" wrap="wrap" gap="md">
              <Stack gap={0} align="center"><Text size="lg" fw={700} c="teal">{fmt(inc)}</Text><Text size="xs" c="dimmed">Income</Text></Stack>
              <Stack gap={0} align="center"><Text size="lg" fw={700} c="red">{fmt(sp)}</Text><Text size="xs" c="dimmed">Spending</Text></Stack>
              <Stack gap={0} align="center">
                <Text size="lg" fw={700} c={net >= 0 ? 'teal' : 'red'}>{net >= 0 ? '+' : '−'}{fmt(net)}</Text>
                <Text size="xs" c="dimmed">Net</Text>
              </Stack>
              {meta.savingsRate !== null && meta.savingsRate !== undefined && (
                <Stack gap={0} align="center">
                  <Text size="lg" fw={700} c={meta.savingsRate >= 0 ? 'teal' : 'red'}>{meta.savingsRate}%</Text>
                  <Text size="xs" c="dimmed">Savings rate</Text>
                </Stack>
              )}
            </Group>
            <Divider my="xs" label="Income transactions this month" labelPosition="left" />
            {renderTransactionTable(meta.incomeList, 'teal')}
          </Stack>
        );
      }
      case 'overspent':
        if (!meta.overspentList?.length) return <Text c="dimmed" ta="center" py="lg">Nothing overspent — nice work.</Text>;
        return (
          <Box style={{ overflowX: 'auto' }}>
            <Table striped withTableBorder fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Category</Table.Th>
                  <Table.Th ta="right">Over by</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {meta.overspentList.map((c) => (
                  <Table.Tr key={c.name}>
                    <Table.Td>{c.name}</Table.Td>
                    <Table.Td ta="right" fw={600} c="red">{fmt(c.by)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        );
      case 'subscriptions':
        if (!meta.subscriptionsList?.length) return <Text c="dimmed" ta="center" py="lg">No recurring charges detected over the last 95 days.</Text>;
        return (
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {meta.subscriptionCount} recurring {meta.subscriptionCount === 1 ? 'charge' : 'charges'} totalling ~{fmt(meta.subscriptionTotal)}/month.
            </Text>
            <Box style={{ overflowX: 'auto' }}>
              <Table striped withTableBorder fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Payee</Table.Th>
                    <Table.Th ta="right">Monthly</Table.Th>
                    <Table.Th ta="right">Charges</Table.Th>
                    <Table.Th>Price change</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {meta.subscriptionsList.map((s) => (
                    <Table.Tr key={s.payee}>
                      <Table.Td>{s.payee}</Table.Td>
                      <Table.Td ta="right" fw={600}>{fmt(s.monthly)}</Table.Td>
                      <Table.Td ta="right">{s.occurrences}</Table.Td>
                      <Table.Td>
                        {s.price_increase
                          ? <Text size="xs" c="orange">{fmt(s.price_increase.from)} → {fmt(s.price_increase.to)}</Text>
                          : <Text size="xs" c="dimmed">—</Text>}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          </Stack>
        );
      case 'days':
        return (
          <Text size="sm">
            You're <strong>{meta.dayOfMonth}</strong> day{meta.dayOfMonth !== 1 ? 's' : ''} into {monthLabel} —
            <strong> {meta.daysInMonth - meta.dayOfMonth}</strong> day{(meta.daysInMonth - meta.dayOfMonth) !== 1 ? 's' : ''} remaining of {meta.daysInMonth} total.
          </Text>
        );
      default:
        return null;
    }
  })();

  const titles = {
    spent: `Spending — ${monthLabel}`,
    projected: 'How the projection is calculated',
    net: `Cash flow — ${monthLabel}`,
    savings: `Savings rate — ${monthLabel}`,
    overspent: 'Overspent categories',
    subscriptions: 'Recurring charges',
    days: 'Time in month',
  };

  return (
    <Modal opened={!!drill} onClose={onClose} title={titles[drill] ?? 'Detail'} size="lg" centered>
      {content}
    </Modal>
  );
}

// Clickable stat tile — keyboard-accessible, no underline; hover lift on desktop.
function StatTile({ value, label, color, onClick }) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 6,
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--mantine-color-default-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Stack gap={2} align="center">
        <Text size="xl" fw={700} c={color}>{value}</Text>
        <Text size="xs" c="dimmed">{label}</Text>
      </Stack>
    </UnstyledButton>
  );
}

// Contributing data behind an insight — method note, per-item breakdown, and
// the transactions that produced the numbers.
function InsightDetails({ details }) {
  if (!details) return null;
  const amtColor = (s) => String(s).trim().startsWith('-') ? 'red' : undefined;

  return (
    <Stack gap="xs" px="md" pb="sm">
      {details.note && <Text size="xs" c="dimmed">{details.note}</Text>}

      {details.breakdown?.length > 0 && (
        <Table fz="xs" withTableBorder>
          <Table.Tbody>
            {details.breakdown.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td>{r.label}</Table.Td>
                <Table.Td ta="right" fw={600} c={amtColor(r.amount)} style={{ whiteSpace: 'nowrap' }}>{r.amount}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {details.transactions?.length > 0 && (
        <>
          <Divider label="Contributing transactions" labelPosition="left" my={2} />
          <Box style={{ overflowX: 'auto' }}>
            <Table striped fz="xs" withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Payee</Table.Th>
                  <Table.Th>Category</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {details.transactions.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{t.date}</Table.Td>
                    <Table.Td>{t.payee || '—'}</Table.Td>
                    <Table.Td>{t.category || '—'}</Table.Td>
                    <Table.Td ta="right" fw={600} c={parseFloat(t.amount) >= 0 ? 'teal' : 'red'} style={{ whiteSpace: 'nowrap' }}>
                      ${Math.abs(parseFloat(t.amount)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        </>
      )}
    </Stack>
  );
}

// Collapsible insight — pill header with icon + title; click to expand body.
function InsightPill({ icon, color, title, body, details, open, onToggle }) {
  return (
    <Paper
      withBorder
      radius="md"
      style={{ borderColor: `var(--mantine-color-${color}-light-color)`, overflow: 'hidden' }}
    >
      <UnstyledButton
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 14px',
          background: `var(--mantine-color-${color}-light)`,
        }}
      >
        <ThemeIcon size="sm" radius="xl" color={color} variant="filled" style={{ flexShrink: 0 }}>
          {icon}
        </ThemeIcon>
        <Text fw={600} size="sm" style={{ flex: 1, textAlign: 'left' }}>{title}</Text>
        <IconChevronDown
          size={16}
          style={{
            flexShrink: 0,
            transition: 'transform 150ms ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </UnstyledButton>
      <Collapse in={open}>
        <Text size="sm" px="md" py="sm">{body}</Text>
        <InsightDetails details={details} />
      </Collapse>
    </Paper>
  );
}

// Cache survives tab switches (the tab unmounts) so revisiting doesn't refetch.
const insightsCache = new Map(); // `${budgetId}:${YYYY-MM}` → { insights, meta, at }
const INSIGHTS_TTL = 5 * 60 * 1000;

function InsightsTab({ budgetId }) {
  const [insights, setInsights] = useState([]);
  const [meta, setMeta]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [drill, setDrill]       = useState(null);
  const [openInsights, setOpenInsights] = useState(() => new Set());
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const monthKey = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`;
  const cacheKey = `${budgetId}:${monthKey}`;

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/agent/insights', { params: { budgetId, month: monthKey } });
      setInsights(res.data.insights ?? []);
      setMeta(res.data.meta);
      setOpenInsights(new Set());
      insightsCache.set(cacheKey, { insights: res.data.insights ?? [], meta: res.data.meta, at: Date.now() });
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [budgetId, monthKey, cacheKey]);

  // Auto-load on open and on month change — deterministic and fast, no reason
  // to hide behind a button. Cached for 5 min per budget+month to spare the API.
  useEffect(() => {
    if (!budgetId) return;
    const cached = insightsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < INSIGHTS_TTL) {
      setInsights(cached.insights);
      setMeta(cached.meta);
      setOpenInsights(new Set());
      return;
    }
    fetchInsights();
  }, [budgetId, cacheKey, fetchInsights]);

  const insightIcon = {
    warning:  <IconAlertTriangle size={16} />,
    tip:      <IconBulb size={16} />,
    positive: <IconCircleCheck size={16} />,
  };
  const insightColor = { warning: 'orange', tip: 'blue', positive: 'teal' };

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <Text fw={600}>Monthly insights</Text>
          <Text size="sm" c="dimmed">Computed from your real transactions — expand any insight to see the data behind it</Text>
        </Stack>
        <Group gap="sm" wrap="nowrap">
          <MonthPickerInput
            size="sm"
            value={selectedMonth}
            onChange={(v) => v && setSelectedMonth(v)}
            maxDate={new Date()}
            valueFormat="MMMM YYYY"
            placeholder="Select month"
            style={{ minWidth: 160 }}
          />
          <Button
            size="sm"
            leftSection={loading ? <Loader size="xs" color="white" /> : <IconRefresh size={14} />}
            onClick={fetchInsights}
            disabled={loading}
          >
            {loading ? 'Analyzing…' : 'Refresh'}
          </Button>
        </Group>
      </Group>

      {meta && (
        <Paper withBorder p="sm" radius="md">
          <Text size="xs" c="dimmed" mb="xs" ta="center">Tap any tile for details</Text>
          <Group gap="xl" wrap="wrap" justify="center">
            <StatTile
              value={`$${parseFloat(meta.totalSpent).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              label={meta.isCurrentMonth ? 'Spent so far' : 'Total spent'}
              onClick={() => setDrill('spent')}
            />
            {meta.isCurrentMonth && (
              <StatTile
                value={`$${parseFloat(meta.projectedEnd).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                label="Projected total"
                onClick={() => setDrill('projected')}
              />
            )}
            {meta.net !== undefined && (
              <StatTile
                value={`${parseFloat(meta.net) >= 0 ? '+' : '−'}$${Math.abs(parseFloat(meta.net)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                label="Net cash flow"
                color={parseFloat(meta.net) >= 0 ? 'teal' : 'red'}
                onClick={() => setDrill('net')}
              />
            )}
            {meta.savingsRate !== null && meta.savingsRate !== undefined && (
              <StatTile
                value={`${meta.savingsRate}%`}
                label="Savings rate"
                color={meta.savingsRate >= 0 ? 'teal' : 'red'}
                onClick={() => setDrill('savings')}
              />
            )}
            <StatTile
              value={meta.overspentCount}
              label="Overspent"
              color={meta.overspentCount > 0 ? 'red' : 'teal'}
              onClick={() => setDrill('overspent')}
            />
            {meta.subscriptionTotal !== undefined && (
              <StatTile
                value={`$${parseFloat(meta.subscriptionTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                label="Subscriptions/mo"
                onClick={() => setDrill('subscriptions')}
              />
            )}
            {meta.isCurrentMonth && (
              <StatTile
                value={`${meta.dayOfMonth}/${meta.daysInMonth}`}
                label="Days elapsed"
                onClick={() => setDrill('days')}
              />
            )}
          </Group>
        </Paper>
      )}

      <InsightDrillModal drill={drill} meta={meta} onClose={() => setDrill(null)} />

      {insights.map((insight, i) => (
        <InsightPill
          key={i}
          icon={insightIcon[insight.type] ?? <IconBulb size={16} />}
          color={insightColor[insight.type] ?? 'blue'}
          title={insight.title}
          body={insight.body}
          details={insight.details}
          open={openInsights.has(i)}
          onToggle={() => setOpenInsights(prev => {
            const next = new Set(prev);
            next.has(i) ? next.delete(i) : next.add(i);
            return next;
          })}
        />
      ))}

      {loading && !insights.length && (
        <Paper withBorder p="xl" radius="md" style={{ textAlign: 'center' }}>
          <Loader size="sm" color="teal" />
          <Text c="dimmed" size="sm" mt="xs">Analyzing this month's spending…</Text>
        </Paper>
      )}
    </Stack>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const { activeBudgetId } = useYNAB();
  const [status, setStatus] = useState(null);

  const loadStatus = useCallback(() => {
    api.get('/agent/status')
      .then(r => setStatus(r.data))
      .catch(() => setStatus({ provider: 'ollama', configured: false, reachable: false }));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const configured = !!status?.configured;
  const providerLabel = status?.provider === 'anthropic'
    ? 'Claude'
    : 'Ollama';

  // Remember which tab was active across app restarts (iOS kills the PWA)
  const [activeTab, setActiveTab] = usePersistentState('agent-tab', 'chat');

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <ThemeIcon size="lg" radius="md" color="teal" variant="light">
            <IconRobot size={18} />
          </ThemeIcon>
          <Title order={2}>Marie AI</Title>
        </Group>

        <Group gap="sm">
          {/* Model switcher — Ollama only */}
          {status && <ModelSwitcher status={status} onChanged={loadStatus} />}

          {status && (
            <Badge
              color={configured ? 'teal' : 'orange'}
              variant="light"
              leftSection={configured ? <IconCircleCheck size={12} /> : <IconServer size={12} />}
            >
              {configured
                ? `${providerLabel} · ${status.model}`
                : status.provider === 'ollama' && !status.reachable
                  ? 'Ollama offline'
                  : 'Not configured'}
            </Badge>
          )}
        </Group>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="chat"         leftSection={<IconRobot size={14} />}>Chat</Tabs.Tab>
          <Tabs.Tab value="categorize"   leftSection={<IconTag size={14} />}>Auto-categorize</Tabs.Tab>
          <Tabs.Tab value="insights"     leftSection={<IconSparkles size={14} />}>Insights</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="chat" pt="md">
          <ChatTab status={status} budgetId={activeBudgetId} />
        </Tabs.Panel>

        <Tabs.Panel value="categorize" pt="md">
          <AutoCategorizeTab status={status} />
        </Tabs.Panel>

        <Tabs.Panel value="insights" pt="md">
          <InsightsTab budgetId={activeBudgetId} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
