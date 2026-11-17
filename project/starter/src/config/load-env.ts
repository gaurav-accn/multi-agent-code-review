/**
 * Side-effect module: load .env BEFORE any other module reads process.env.
 * ES module imports are evaluated in order, so main.ts imports this first.
 * `override: true` lets values in .env replace variables already set by the workspace.
 */
import * as dotenv from 'dotenv';

dotenv.config({ override: true });