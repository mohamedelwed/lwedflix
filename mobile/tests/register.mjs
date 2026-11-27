// Lets `node --test` resolve the app's aliases: @electron/x → ../electron/x.js.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
