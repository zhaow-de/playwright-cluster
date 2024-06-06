# Playwright Cluster

Current version: **v1.3.0**

![Build Status](https://github.com/zhaow-de/playwright-cluster/actions/workflows/build.yml/badge.svg)
![npm (scoped)](https://img.shields.io/npm/v/@zhaow-de/playwright-cluster)
![npm download](https://img.shields.io/npm/dm/@zhaow-de/playwright-cluster)
![Coverage Status](https://coveralls.io/repos/github/zhaow-de/playwright-cluster/badge.svg?branch=main)
![Known Vulnerabilities](https://snyk.io/test/github/zhaow-de/playwright-cluster/badge.svg)
![MIT License](https://img.shields.io/npm/l/@zhaow-de/playwright-cluster.svg)

[puppeteer-cluster](https://github.com/thomasdondorf/puppeteer-cluster) is a great library manages a
[puppeteer](https://github.com/puppeteer/puppeteer) cluster. This is re-implementation to make it work with 
[Playwright](https://github.com/microsoft/playwright), aiming at 100% API compatibility as a turn-key replacement.

## Install

`npm --save @zhaow-de/playwright-cluster`

## Usage

The documentation from puppeteer-cluster is still valid as the reference.

- [Usage](https://github.com/thomasdondorf/puppeteer-cluster#usage)
- [Examples](https://github.com/thomasdondorf/puppeteer-cluster#examples)
- [Concurrency implementations](https://github.com/thomasdondorf/puppeteer-cluster#concurrency-implementations)
- [Typings for input/output (via TypeScript Generics)](https://github.com/thomasdondorf/puppeteer-cluster#typings-for-inputoutput-via-typescript-generics)
- [Debugging](https://github.com/thomasdondorf/puppeteer-cluster#debugging)
- [API](https://github.com/thomasdondorf/puppeteer-cluster#api)

## Note

1. Firefox is hardcoded as the headless browser. This library does not work with Chromium or Webkit.
2. `BrowserContext` is not available in Puppeteer. Some options, e.g. `ignoreHTTPSErrors` cannot be directly translated from 
   `puppeteerOptions` to `playwrightOptions`. Therefore, we introduced `contextOptions` as an optional property in `ClusterOptions`.
