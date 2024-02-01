import { SleepingDiscord } from "./sleepingDiscord";
import { getLogger, LoggerType } from "./sleepingLogger";
import { getSettings, Settings } from "./sleepingSettings";
import { SleepingWeb } from "./sleepingWeb";

const logger: LoggerType = getLogger();
const settings = getSettings()
const discord = new SleepingDiscord(settings);
process.on("SIGINT", async () => {
  logger.info("[Main] SIGINT signal received.");
  await close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("[Main] SIGTERM  signal received.");
  await close();
  process.exit(0);
});

process.on("uncaughtException", (err: Error) => {
  logger.warn(
    `[Main] Caught uncaughtException: ${JSON.stringify(err.message ?? err)}`
  );

  if ((err as any).code === "ECONNRESET") {
    logger.info("[Main] Connection reset client side... Keep on going.");
    return;
  }
  if ((err as any).code === "EADDRINUSE") {
    logger.info(
      `[Main] A server is already using the port. Kill it and restart the app.`,
      err.message ?? err
    );
  }
  if (
    err.message !== "undefined"
    // && err.message.indexOf('handshaking.toServer')
  ) {
    logger.error("[Main] Something bad happened", err.message);
  }
});

const main = async () => {
  new SleepingWeb(settings, discord.onPlayerJoin)
};

main();