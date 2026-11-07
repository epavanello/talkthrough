import { mount } from 'svelte';
import App from './App.svelte';
import BrowserApp from './BrowserApp.svelte';
import './app.css';

// One bundle, two webviews: the review chat, and the browser panel beside the code
mount(document.body.dataset.view === 'browser' ? BrowserApp : App, {
  target: document.getElementById('app')!
});
