# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**nosk** is a task and notes management system designed to sync seamlessly across devices. The project is in its initial setup phase.

## Project Goals

- Create a system for managing tasks and notes
- Enable cross-device synchronization
- Provide a seamless user experience across platforms

## Architecture Decisions to Consider

When implementing this project, consider:

1. **Sync Strategy**: Determine the synchronization mechanism (real-time sync, conflict resolution, offline-first architecture)
2. **Data Storage**: Choose between local-first with sync (e.g., SQLite + sync protocol) vs cloud-first (e.g., Firebase, Supabase)
3. **Platform Support**: Define target platforms (web, mobile, desktop) and whether to use cross-platform frameworks
4. **Authentication**: Plan user authentication and authorization for multi-device access

## Development Setup

This section will be populated as the project structure is established. Future commands for building, testing, and running the application will be added here.

## Key Implementation Areas

When developing features, focus on:

- **Data Model**: Task and note structures, relationships, metadata (timestamps, tags, categories)
- **Sync Engine**: Conflict resolution, versioning, offline queue management
- **Storage Layer**: Local persistence and sync state management
- **API/Protocol**: Communication format between devices and any backend services
