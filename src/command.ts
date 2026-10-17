#!/usr/bin/env node
import "dotenv/config";
import { main } from "./main.js";

process.exitCode = await main(process.argv.slice(2), "help");
