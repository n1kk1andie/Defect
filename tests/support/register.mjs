// node --import ./tests/support/register.mjs — see alias-hooks.mjs.
import { register } from "node:module";
register("./alias-hooks.mjs", import.meta.url);
