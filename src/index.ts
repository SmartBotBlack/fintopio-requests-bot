import axios from "axios";
import "colors";
import { input, select } from "@inquirer/prompts";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import Database from "better-sqlite3";
import env from "./env";
import { HttpsProxyAgent } from "https-proxy-agent";
const { DateTime } = require("luxon");
const db = new Database("accounts.db");

const BASE_URL = "https://fintopio-tg.fintopio.com/api";

const ensureTableExists = () => {
	const tableExists = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='accounts';",
		)
		.get();

	if (!tableExists) {
		db.prepare(`
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phoneNumber TEXT,
                session TEXT,
                proxy TEXT
            );
        `).run();
	}
};

const _headers = {
	Accept: "application/json, text/plain, */*",
	"Accept-Encoding": "gzip, deflate, br",
	"Accept-Language": "en-US,en;q=0.9",
	"Content-Type": "application/json",
	Referer: "https://fintopio-tg.fintopio.com/",
	"Sec-Ch-Ua":
		'"Not/A)Brand";v="8", "Chromium";v="126", "Mobile Safari";v="605.1.15"',
	"Sec-Ch-Ua-Mobile": "?1",
	"Sec-Ch-Ua-Platform": '"iOS"',
	"User-Agent":
		"Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
};

const createSession = async (phoneNumber: string, proxy: string) => {
	try {
		const client = new TelegramClient(
			new StringSession(""),
			env.APP_ID,
			env.API_HASH,
			{
				deviceModel: env.DEVICE_MODEL,
				connectionRetries: 5,
			},
		);

		await client.start({
			phoneNumber: async () => phoneNumber,
			password: async () => await input({ message: "Enter your password:" }),
			phoneCode: async () =>
				await input({ message: "Enter the code you received:" }),
			onError: (err: Error) => {
				if (
					!err.message.includes("TIMEOUT") &&
					!err.message.includes("CastError")
				) {
					console.log(`Telegram authentication error: ${err.message}`.red);
				}
			},
		});

		console.log("Successfully created a new session!".green);
		const stringSession = client.session.save() as unknown as string;

		db.prepare(
			"INSERT INTO accounts (phoneNumber, session, proxy) VALUES (@phoneNumber, @session, @proxy)",
		).run({ phoneNumber, session: stringSession, proxy });

		await client.sendMessage("me", {
			message: "Successfully created a new session!",
		});
		console.log("Saved the new session to session file.".green);
		await client.disconnect();
		await client.destroy();
	} catch (e) {
		const error = e as Error;
		if (
			!error.message.includes("TIMEOUT") &&
			!error.message.includes("CastError")
		) {
			console.log(`Error: ${error.message}`.red);
		}
	}
};

const showAllAccounts = () => {
	const stmt = db.prepare("SELECT phoneNumber, proxy FROM accounts");
	for (const row of stmt.iterate()) {
		console.log(row);
	}
};

const getQueryId = async (phoneNumber: string, session: string) => {
	const client = new TelegramClient(
		new StringSession(session),
		env.APP_ID,
		env.API_HASH,
		{
			deviceModel: env.DEVICE_MODEL,
			connectionRetries: 5,
		},
	);

	await client.start({
		phoneNumber: async () => phoneNumber,
		password: async () => await input({ message: "Enter your password:" }),
		phoneCode: async () =>
			await input({ message: "Enter the code you received:" }),
		onError: (err: Error) => {
			if (
				!err.message.includes("TIMEOUT") &&
				!err.message.includes("CastError")
			) {
				console.log(`Telegram authentication error: ${err.message}`.red);
			}
		},
	});

	try {
		const peer = await client.getInputEntity("fintopio");
		if (!peer) {
			console.log("Failed to get peer entity.".red);
			return;
		}
		const webview = await client.invoke(
			new Api.messages.RequestWebView({
				peer,
				bot: peer,
				fromBotMenu: false,
				platform: "ios",
				url: "https://fintopio-tg.fintopio.com/",
			}),
		);
		if (!webview || !webview.url) {
			console.log("Failed to get webview URL.".red);
			return;
		}
		const query = decodeURIComponent(
			webview.url.split("&tgWebAppVersion=")[0].split("#tgWebAppData=")[1],
		);

		return query;
	} catch (e) {
		console.log(`Error retrieving query data: ${(e as Error).message}`.red);
	} finally {
		await client.disconnect();
		await client.destroy();
	}
};

const getRandomInt = (min: number, max: number) =>
	Math.floor(Math.random() * (max - min + 1)) + min;

const extractUserData = (queryId: string) => {
	const urlParams = new URLSearchParams(queryId);
	const user = JSON.parse(decodeURIComponent(urlParams.get("user") ?? ""));
	return {
		extUserId: user.id,
		extUserName: user.username,
	};
};

const auth = async (queryId: string, proxy: string) => {
	const url = `${BASE_URL}/auth/telegram`;
	const headers = { ..._headers, Webapp: "true" };

	try {
		const response = await axios.get(
			`${url}?${queryId}`,
			proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
		);

		return response.data.token;
	} catch (e) {
		const error = e as Error;
		throw new Error(`Authentication error: ${error.message}`);
	}
};

const getProfile = async (token: string, proxy: string) => {
	const url = `${BASE_URL}/referrals/data`;
	const headers = {
		..._headers,
		Authorization: `Bearer ${token}`,
		Webapp: "false, true",
	};

	try {
		const response = await axios.get(
			url,
			proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
		);
		return response.data;
	} catch (e) {
		const error = e as Error;
		throw new Error(`Failed to fetch profile: ${error.message}`);
	}
};

const checkInDaily = async (token: string, proxy: string) => {
	const url = `${BASE_URL}/daily-checkins`;
	const headers = {
		..._headers,
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};

	try {
		await axios.post(
			url,
			{},
			proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
		);
	} catch (e) {
		const error = e as Error;
		throw new Error(`Daily check-in failed: ${error.message}`);
	}
};

const getFarmingState = async (token: string, proxy: string) => {
	const url = `${BASE_URL}/farming/state`;
	const headers = {
		..._headers,
		Authorization: `Bearer ${token}`,
	};

	try {
		const response = await axios.get(
			url,
			proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
		);
		return response.data;
	} catch (e) {
		const error = e as Error;
		throw new Error(`Error retrieving farming state: ${error.message}`);
	}
};

const startFarming = async (prefix: string, token: string, proxy: string) => {
	const url = `${BASE_URL}/farming/farm`;
	const headers = {
		..._headers,
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};

	try {
		const response = await axios.post(
			url,
			{},
			proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
		);
		const finishTimestamp = response.data.timings.finish;

		if (finishTimestamp) {
			const finishTime = DateTime.fromMillis(finishTimestamp).toFormat(
				"MMMM dd, yyyy 'at' hh:mm a",
			);
			console.log(prefix, "🌱 Farming started...".yellow);
			console.log(prefix, `🎯 Farm completion: ${finishTime}`.green);
		} else {
			console.log(prefix, "No completion time available.".yellow);
		}
	} catch (e) {
		const error = e as Error;
		throw new Error(`Error starting farming: ${error.message}`);
	}
};

const claimFarming = async (token: string, proxy: string) => {
	const url = `${BASE_URL}/farming/claim`;
	const headers = {
		..._headers,
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};

	try {
		await axios.post(
			url,
			{},
			proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
		);
	} catch (e) {
		const error = e as Error;
		throw new Error(`Farm claim failed: ${error.message}`);
	}
};

const calculateWaitTime = (firstAccountFinishTime: number) => {
	if (!firstAccountFinishTime) return null;

	const now = DateTime.now();
	const finishTime = DateTime.fromMillis(firstAccountFinishTime);
	const duration = finishTime.diff(now);

	return duration.as("milliseconds");
};

const farm = async (account: {
	phoneNumber: string;
	session: string;
	proxy: string;
}) => {
	const { phoneNumber, session, proxy } = account;
	const queryId = await getQueryId(phoneNumber, session);
	if (!queryId) {
		console.log(`Failed to get query data for ${phoneNumber}`.red);
		return;
	}

	const { extUserId } = extractUserData(queryId);
	const prefix = `[${extUserId}]`.blue;

	while (true) {
		try {
			const token = await auth(queryId, proxy);

			const profile = await getProfile(token, proxy);

			const balance = profile.balance;
			console.log(prefix, `Balance: ${balance.green}`);

			await checkInDaily(token, proxy);
			console.log(prefix, "Daily check-in successful!".green);

			const farmingState = await getFarmingState(token, proxy);

			let finishTimestamp = farmingState?.timings?.finish ?? 0;

			if (farmingState) {
				if (farmingState.state === "farmed") {
					await claimFarming(token, proxy);
					console.log(prefix, "🎊 Farm claimed successfully!".green);
					await new Promise((res) =>
						setTimeout(res, getRandomInt(1, 10) * 1e3),
					);
					await startFarming(prefix, token, proxy);

					const farmingState = await getFarmingState(token, proxy);
					finishTimestamp = farmingState?.timings?.finish ?? 0;
				} else if (farmingState.state === "idling") {
					await startFarming(prefix, token, proxy);

					const farmingState = await getFarmingState(token, proxy);
					finishTimestamp = farmingState?.timings?.finish ?? 0;
				} else if (farmingState.state === "farming") {
					if (finishTimestamp) {
						const finishTime = DateTime.fromMillis(
							finishTimestamp,
						).toLocaleString(DateTime.DATETIME_FULL);
						console.log(prefix, `🌾 Farm completion: ${finishTime}`.green);

						const currentTime = DateTime.now().toMillis();
						if (currentTime > finishTimestamp) {
							await claimFarming(token, proxy);
							console.log(prefix, "🎊 Farm claimed successfully!".green);
							await new Promise((res) =>
								setTimeout(res, getRandomInt(1, 10) * 1e3),
							);
							await startFarming(prefix, token, proxy);

							const farmingState = await getFarmingState(token, proxy);
							finishTimestamp = farmingState?.timings?.finish ?? 0;
						}
					}
				}
			}

			const waitTime = calculateWaitTime(finishTimestamp);
			if (waitTime && waitTime > 0) {
				await new Promise((res) =>
					setTimeout(res, Math.floor(waitTime) + 5 * 1e3),
				);
			} else {
				console.log(
					prefix,
					"No valid waiting time, continuing immediately.".yellow,
				);
				await new Promise((res) => setTimeout(res, 5 * 1e3));
			}
		} catch (e) {
			const error = e as Error & { code?: string };
			console.log(
				prefix,
				`${"Error farm:".red} ${error.code} ${error.message}`,
			);
			await new Promise((res) => setTimeout(res, 5 * 60 * 1e3));
		}
	}
};

const start = async () => {
	const stmt = db.prepare("SELECT phoneNumber, session, proxy FROM accounts");
	const accounts = [...stmt.iterate()] as {
		phoneNumber: string;
		session: string;
		proxy: string;
	}[];

	await Promise.all(accounts.map(farm));
};

(async () => {
	ensureTableExists();

	while (true) {
		const mode = await select({
			message: "Please choose an option:",
			choices: [
				{
					name: "Start farming",
					value: "start",
					description: "Start playing game",
				},
				{
					name: "Add account",
					value: "add",
					description: "Add new account to DB",
				},
				{
					name: "Show all accounts",
					value: "show",
					description: "show all added accounts",
				},
			],
		});

		switch (mode) {
			case "add": {
				const phoneNumber = await input({
					message: "Enter your phone number (+):",
				});

				const proxy = await input({
					message:
						"Enter proxy (in format http://username:password@host:port):",
				});

				await createSession(phoneNumber, proxy);
				break;
			}
			case "show": {
				showAllAccounts();
				break;
			}
			case "start": {
				await start();
				break;
			}
			default:
				break;
		}
	}
})();
