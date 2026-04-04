// src/scripts/oakSync.ts
import { syncOakForStems } from "../services/oakSync.service.js";

(async () => {
  const stats = await syncOakForStems();
  console.log("Oak sync complete:", stats);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
