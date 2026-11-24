// Entry point bundled by scripts/vendor.mjs into lib/excalidraw/bundle.js.
// Loaded lazily via dynamic import() only when an Excalidraw drawing or embed is opened.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToSvg, getSceneVersion, restore, serializeAsJSON } from '@excalidraw/excalidraw';

export { React, createRoot, Excalidraw, exportToSvg, getSceneVersion, restore, serializeAsJSON };
