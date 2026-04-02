import { config } from "./config.js";
import { app } from "./app.js";

app.listen(config.port, () => {
  console.log(`API running on port ${config.port}`);
});
