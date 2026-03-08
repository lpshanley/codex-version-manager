import { createInterface } from "node:readline";

export async function confirm(message: string): Promise<boolean> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(`${message} [Y/n] `, (answer) => {
			rl.close();
			const normalized = answer.trim().toLowerCase();
			resolve(normalized === "" || normalized === "y" || normalized === "yes");
		});
	});
}
