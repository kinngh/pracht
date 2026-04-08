# @pracht/adapter-vercel

Vercel adapter for pracht. Supports serverless and edge function deployment via the Build Output API v3.

## Install

```bash
npm install @pracht/adapter-vercel
```

## Usage

Select the Vercel adapter when scaffolding with `create-pracht`, or add it to an existing project:

```bash
npm create pracht@latest my-app  # choose Vercel
```

Deploy with:

```bash
pracht build && vercel deploy --prebuilt
```

## Features

- Build Output API v3 integration
- Serverless function support
- Edge function support
