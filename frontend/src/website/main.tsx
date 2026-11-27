import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Website from './Website';
import './website.css';
import './website-light.css';

createRoot(document.getElementById('website-root')!).render(<StrictMode><Website /></StrictMode>);
