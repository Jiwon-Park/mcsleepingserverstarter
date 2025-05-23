import express, { Express } from "express";
import { engine } from "express-handlebars";
import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";
import {
  UpdateDomainEntryCommand,
  GetDomainCommand,
  LightsailClient,
} from "@aws-sdk/client-lightsail";
import * as https from "https";
import * as http from "http";
import path from "path";
import { SleepingDiscord } from "./sleepingDiscord.js";
import { getFavIcon, getMOTD, ServerStatus } from "./sleepingHelper.js";
import { getLogger, LoggerType } from "./sleepingLogger.js";
import { ISleepingServer } from "./sleepingServerInterface.js";
import { Settings } from "./sleepingSettings.js";
import { Player, PlayerConnectionCallBackType } from "./sleepingTypes.js";
import { Socket } from "node:net";
import pkg from "minecraft-protocol";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";
const __dirname = fileURLToPath(import.meta.url);

const { ping } = pkg;

export class SleepingWeb implements ISleepingServer {
  settings: Settings;
  playerConnectionCallBack: PlayerConnectionCallBackType;
  logger: LoggerType;
  app: Express;
  sslOptions = {
    cert: "",
    key: "",
  };
  server?: http.Server;
  httpsserver?: https.Server;
  webPath = "";
  waking = false;
  stopped = true;
  unrespondcount = 0;
  noOneKillEvent?: NodeJS.Timeout = undefined;
  client = new EC2Client({ region: "ap-northeast-2" });
  LSclient = new LightsailClient({ region: "us-east-1" });
  status = -1;
  discord: SleepingDiscord;
  minecraftHost = "";

  PING_INTERVAL = 60000 as const; // 60 seconds
  STOPPING_TIMEOUT_MIN = 10 as const; // 10 minutes

  constructor(settings: Settings) {
    this.settings = settings;
    this.discord = new SleepingDiscord(settings);
    if (this.settings.webSubPath) {
      this.webPath = this.settings.webSubPath;
    }
    this.playerConnectionCallBack = this.startMinecraft;

    this.logger = getLogger();
    this.app = express();
    this.pingEvent(true);
    this.sslOptions.cert = fs.readFileSync(
      "/etc/letsencrypt/live/wake.seni.kr/fullchain.pem",
      "utf8"
    );
    this.sslOptions.key = fs.readFileSync(
      "/etc/letsencrypt/live/wake.seni.kr/privkey.pem",
      "utf8"
    );
  }

  pingEvent = async (ignore_condition = false) => {
    if (ignore_condition || this.waking || this.status > -1) {
      this.getOnlineUserCnt().then((status) => {
        if (status == undefined) {
          status = 0;
        }
        if (this.status >= 0 && status == -1) {
          this.logger.info(`[WebServer] Server is not responding.`);
          this.unrespondcount++;
          if (this.stopped == false && this.unrespondcount > 10) {
            this.unrespondcount = 0;
            this.discord.onServerCrash();
            this.stopped = true;
          }
          this.status = status;
          setTimeout(this.pingEvent, this.PING_INTERVAL);
          return;
        }
        this.unrespondcount = 0;
        this.logger.info("status and waking");
        this.logger.info(this.status);
        this.logger.info(this.waking);
        this.status = status;
        if (this.waking && this.status >= 0) {
          this.discord.onServerStart();
          this.stopped = false;
          this.waking = false;
          this.logger.info("waking is now false");
        }
        if (this.noOneKillEvent == undefined && this.status == 0) {
          this.logger.info(
            `[WebServer] No one is on the server, starting the ${this.STOPPING_TIMEOUT_MIN} minute timer.`
          );
          this.noOneKillEvent = setTimeout(async () => {
            if (this.status == 0 || this.status == undefined) {
              this.logger.info(
                `[WebServer] No one is on the server, stopping the server.`
              );
              this.killMinecraft(false);
            }
            this.noOneKillEvent = undefined;
          }, this.STOPPING_TIMEOUT_MIN * 60000); // 10 minutes
        } else if (this.noOneKillEvent && this.status > 0) {
          this.logger.info(
            `[WebServer] Someone joined the server, stopping the 10 minute timer.`
          );
          clearTimeout(this.noOneKillEvent);
          this.noOneKillEvent = undefined;
        }
        setTimeout(this.pingEvent, this.PING_INTERVAL);
      });
    }
  };

  getIp = (socket: Socket) => {
    return this.settings.hideIpInLogs ? "" : `(${socket.remoteAddress})`;
  };

  init = async () => {
    this.app.engine(
      "hbs",
      engine({
        defaultLayout: "main",
        layoutsDir: path.join(__dirname, "../views/layouts/"),
        extname: ".hbs",
        helpers: {
          title: () => {
            return getMOTD(this.settings, "plain", true);
          },
          motd: () => {
            return getMOTD(this.settings, "html", true);
          },
          favIcon: () => {
            return getFavIcon(this.settings);
          },
          stylesheet: () => {
            return `${this.webPath}/layouts/main.css`;
          },
        },
      })
    );

    this.app.set("view engine", "hbs");
    this.app.use(express.json());
    this.app.use(
      `${this.webPath}/layouts`,
      express.static(path.join(__dirname, "../views/layouts"))
    );

    this.app.use(
      `${this.webPath}/res`,
      express.static(path.join(__dirname, "../views/res"))
    );

    // this.configureDynmap();

    this.app.get(/(.*)/, (req, res, next) => {
      if (req.hostname != "wake.seni.kr") {
        res.status(400);
        return res.send("Bad request");
      } else if (req.secure) {
        next();
      } else {
        const to = "https://" + req.headers.host + req.url;
        this.logger.info("to ==> " + to);
        return res.redirect("https://" + req.headers.host + req.url);
      }
    });

    this.app.get(`${this.webPath}/`, (req, res) => {
      res.render(path.join(__dirname, "../views/home"), {
        message: this.settings.loginMessage,
      });
    });

    this.app.post(`${this.webPath}/wakeup`, async (req, res) => {
      res.send("received");

      const currentStatus = this.resolveStatus(this.status);

      switch (currentStatus) {
        case ServerStatus.Sleeping:
          {
            this.logger.info(
              `[WebServer]${this.getIp(
                req.socket
              )} Wake up server was ${currentStatus}`
            );
            this.waking = true;
            this.playerConnectionCallBack(Player.web());
          }
          break;
        case ServerStatus.Running:
          {
            this.logger.info(
              `[WebServer]${this.getIp(
                req.socket
              )} Stopping server was ${currentStatus}`
            );
            this.killMinecraft(false);
          }
          break;
        case ServerStatus.Starting:
          {
            this.logger.info(
              `[WebServer]${this.getIp(
                req.socket
              )} Doing nothing server was ${currentStatus}`
            );
          }
          break;
        default: {
          this.logger.warn(
            `[WebServer]${this.getIp(req.socket)} Server is ?! ${currentStatus}`
          );
        }
      }
    });

    this.app.post(`${this.webPath}/restart`, async (req, res) => {
      res.send("received");

      this.logger.info(`[WebServer]${this.getIp(req.socket)} Restart server`);

      this.killMinecraft(true);
    });

    this.app.get(`${this.webPath}/status`, async (req, res) => {
      const status = this.resolveStatus(this.status);
      res.json({
        status,
        dynmap: this.settings.webServeDynmap,
        settings: {
          preventStop: this.settings.preventStop ?? false,
          webAllowRestart: this.settings.webAllowRestart,
        },
      });
    });

    this.app.post(`${this.webPath}/shutdown`, async (req, res) => {
      res.send("received");
      this.logger.info(`[WebServer]${this.getIp(req.socket)} Shutdown server`);
      setTimeout(() => {
        this.killMinecraft(false, true);
        this.waking = false;
      }, 60000);
    });

    this.app.post(`${this.webPath}/change_dns`, async (req, res) => {
      this.logger.info(`${req.body.key}, ${req.body.ip}, ${req.body.hostname}`);
      if (req.body.key == this.settings.webKey) {
        const getDomain = new GetDomainCommand({
          domainName: "seni.kr",
        });
        const resp = await this.LSclient.send(getDomain);
        //find matching domainEntry from req.body.hostname
        if (resp.domain?.domainEntries) {
          const domainEntry = resp.domain.domainEntries.find(
            (entry) => entry.name == req.body.hostname
          );
          if (domainEntry) {
            const updateDomain = new UpdateDomainEntryCommand({
              domainName: "seni.kr",
              domainEntry: {
                id: domainEntry.id,
                name: domainEntry.name,
                target: req.body.ip,
                type: domainEntry.type,
              },
            });
            const result = await this.LSclient.send(updateDomain);
            this.logger.info(result);
            res.send("received");
          } else {
            res.send("No matching domain entry");
          }
        } else {
          res.send("No domain entry");
        }
      }
    });

    const httpsServer = https.createServer(this.sslOptions, this.app);
    const httpServer = http.createServer(this.app);
    this.server = httpServer.listen(80, () => {
      console.log("HTTP server is listening on port 80");
    });
    this.httpsserver = httpsServer.listen(this.settings.webPort, () => {
      this.logger.info(
        `[WebServer] Starting web server on *: ${this.settings.webPort}`
      );
    });
  };

  // configureDynmap = () => {
  //   if (this.settings.webServeDynmap) {
  //     let dynmapPath;
  //     if (typeof this.settings.webServeDynmap === "string") {
  //       dynmapPath = this.settings.webServeDynmap;
  //       if (dynmapPath.includes("http")) {
  //         return;
  //       }
  //     } else {
  //       dynmapPath = path.join(getMinecraftDirectory(this.settings), "plugins/dynmap/web");
  //     }
  //     this.logger.info(`[WebServer] Serving dynmap: ${dynmapPath}`);
  //     if (existsSync(dynmapPath)) {
  //       this.app.use(`${this.webPath}/dynmap`, express.static(dynmapPath));
  //     } else {
  //       this.logger.error(`Dynmap directory at ${dynmapPath} does not exist!`);
  //     }
  //   }
  // };

  getHostName = async () => {
    const command = new DescribeInstancesCommand({
      Filters: [
        {
          Name: "tag:aws:autoscaling:groupName",
          Values: ["minecraft"],
        },
      ],
    });
    const { Reservations } = await this.client.send(command);
    if (Reservations == undefined || Reservations.length == 0) {
      return "craft.seni.kr";
    }
    const instance = Reservations.flatMap(({ Instances }) => Instances)[0];
    if (instance == undefined) {
      return "craft.seni.kr";
    }
    return instance.PublicIpAddress ?? "craft.seni.kr";
  };

  getOnlineUserCnt = async () => {
    this.logger.info(`[WebServer] Getting server status`);
    let hostname = "";
    try {
      hostname = await this.getHostName();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      hostname = "craft.seni.kr";
    }
    if (hostname == "craft.seni.kr") {
      this.logger.error(`[WebServer] Error getting hostname`);
    }

    let pingres = -1;
    try {
      await ping(
        { host: hostname, port: 25565, version: "1.19.4" },
        (err, res): void => {
          if (err) {
            this.logger.error(
              `[WebServer] Error getting server status: ${err}`
            );
            pingres = -1;
          } else if (res) {
            if ("players" in res) {
              pingres = res.players.online;
            } else {
              pingres = res.playerCount;
            }
            this.logger.info(
              `[WebServer] Server is responding with ${pingres} players`
            );
          } else {
            pingres = -1;
            this.logger.info(`[WebServer] Server is not responding`);
          }
        }
      );
    } catch (e) {
      this.logger.error(e);
      pingres = -1;
    }
    return pingres;
  };

  resolveStatus = (status: number) => {
    let resolvedStatus = "";

    if (status == -1) {
      if (this.waking) resolvedStatus = ServerStatus.Starting;
      else resolvedStatus = ServerStatus.Sleeping;
    } else {
      resolvedStatus = ServerStatus.Running;
    }
    return resolvedStatus;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  startMinecraft = async (player: Player) => {
    this.logger.info(`[WebServer] Starting Minecraft Server`);
    if (this.settings.minecraftCommand) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const proc = exec(
        this.settings.minecraftCommand,
        (error, stdout, stderr) => {
          if (error) {
            this.logger.error(`[WebServer] Error starting server: ${error}`);
            return;
          }
          if (stderr) {
            this.logger.warn(
              `[WebServer] Error/Warn starting server: ${stderr}`
            );
          }
          this.logger.info(
            `[WebServer] Started server: ${stdout}\n------------------`
          );
          this.pingEvent();
        }
      );
    } else {
      this.logger.error(
        `[WebServer] No start command defined, cannot start the server`
      );
    }
  };

  killMinecraft = async (restart: boolean, withoutBackup = false) => {
    this.logger.info(
      `[WebServer] Killing Minecraft Server, restart: ${restart}`
    );
    if (this.settings.stopCommand) {
      const stopCommand =
        this.settings.stopCommand +
        (withoutBackup
          ? ' --extra-vars "backup=0"'
          : ' --extra-vars "backup=1"');
      const proc = exec(stopCommand, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`[WebServer] Error stopping server: ${error}`);
          return;
        }
        if (stderr) {
          this.logger.error(`[WebServer] Error stopping server: ${stderr}`);
        }
        this.logger.info(
          `[WebServer] Stopped server: ${stdout}\n------------------`
        );
        if (this.stopped == false) {
          this.discord.onServerStop();
          this.stopped = true;
        }
      });

      if (restart) {
        proc.on("exit", () => {
          setTimeout(() => {
            this.playerConnectionCallBack(Player.web());
          }, 10000);
        });
      }
    } else {
      this.logger.error(
        `[WebServer] No stop command defined, cannot stop the server`
      );
    }
  };

  close = async () => {
    if (this.httpsserver && this.server) {
      this.httpsserver.close();
      this.server.close();
    }
  };
}
