import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/db/migrations", import.meta.url));
const destination = fileURLToPath(new URL("../dist/db/migrations", import.meta.url));

cpSync(source, destination, { recursive: true });