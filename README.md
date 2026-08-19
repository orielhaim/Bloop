# Bloop

Cross-platform dynamic island for your desktop. A small, always-available surface that shows you what matters right now. Everything arrives as a plugin.

## What is the island?

The island is a compact overlay that lives on your screen. It stays out of the way until something worth your attention happens - a track starts playing, the volume changes, a device connects, a timer finishes - and then it surfaces that moment, composed and animated, before quietly stepping aside again.

Bloop brings that idea to the desktop with one defining rule: **the core is a host, not a feature set.** The application only knows how to present, compose, and animate. All content, behavior, and appearance are contributed by plugins.

## Everything is a plugin

A plugin is a small, self-contained package that declares what it provides and the permissions it needs. There are three kinds:

- **Activities** surface live events and state on the island - what is playing, how loud the system is, which devices are connected, how long until the timer ends.
- **Themes** define the island's appearance - its colors, motion, and finish. Even the look of the island is a plugin, so Bloop has no fixed skin.
- **Apps** turn the island into a small interactive experience, with its own controls rather than a passive display.

Each plugin can also expose its own settings. Enable or disable any plugin from the settings window and adjust its behavior through the controls it provides - no code, no configuration files.

## Building plugins

Bloop is designed to be extended, not modified. A plugin declares what it provides, requests only the permissions it needs, and describes its settings in plain language. The repository includes a TypeScript SDK for building new plugins, and the bundled plugins serve as working references for what a plugin can do.

## Roadmap

Bloop is pre-1.0 and moving fast.

- A remote catalog behind the Store, so plugins can be discovered and installed like apps.
- First-class support for every major desktop platform.
- A growing set of capabilities plugins can request, so the island can understand more of your machine.

The goal is simple: a dynamic island that is entirely yours, built from the parts you choose.
