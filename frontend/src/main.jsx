import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme, localStorageColorSchemeManager } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import './mobile.css';
import App from './App';

const theme = createTheme({
  primaryColor: 'teal',
  fontFamily: 'Inter, system-ui, sans-serif',
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
