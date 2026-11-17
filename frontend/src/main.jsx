import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme, localStorageColorSchemeManager, Tooltip, HoverCard } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import './mobile.css';
import App from './App';

// Touch-only devices (iPhone, incl. the unfolded Duo which is wide enough to
// get the desktop layout). iOS turns the first tap on anything that reveals
// hover content into a "hover" and swallows the click — so hover popups are
// switched off entirely where there is no real hover.
const noHover = typeof window !== 'undefined'
  && window.matchMedia?.('(hover: none), (pointer: coarse)').matches;

const theme = createTheme({
  primaryColor: 'teal',
  fontFamily: 'Inter, system-ui, sans-serif',
  components: noHover ? {
    Tooltip:   Tooltip.extend({ defaultProps: { disabled: true } }),
    HoverCard: HoverCard.extend({ defaultProps: { disabled: true } }),
  } : {},
});

// Persist the user's color-scheme preference across reloads
const colorSchemeManager = localStorageColorSchemeManager({ key: 'ynab-color-scheme' });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider
      theme={theme}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="dark"
    >
      {/* limit + autoClose keep stray toasts from stacking up and lingering */}
      <Notifications position="top-right" limit={3} autoClose={3500} />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
