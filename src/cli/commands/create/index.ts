import fse from 'fs-extra';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { resolve } from 'path';
import { databaseQuestions } from './questions';
import { drivers, getDriverForClient } from '../../utils/drivers';
import createEnv from '../../utils/create-env';
import execa from 'execa';
import path from 'path';
import { v4 as uuidV4 } from 'uuid';

import argon2 from 'argon2';

import createDBConnection, { Credentials } from '../../utils/create-db-connection';

export default async function create(directory: string, options: Record<string, any>) {
	const rootPath = resolve(directory);
	checkRequirements();

	if (await fse.pathExists(rootPath)) {
		const stat = await fse.stat(rootPath);

		if (stat.isDirectory() === false) {
			console.error(
				`Destination '${chalk.red(directory)}' already exists and is not a directory.`
			);
			process.exit(1);
		}

		const files = await fse.readdir(rootPath);

		if (files.length > 0) {
			console.error(
				`Destination '${chalk.red(
					directory
				)}' already exists and is not an empty directory.`
			);
			process.exit(1);
		}
	}

	await fse.mkdir(rootPath);
	await fse.mkdir(path.join(rootPath, 'uploads'));
	await fse.mkdir(path.join(rootPath, 'extensions'));

	await execa('npm', ['init', '-y'], {
		cwd: rootPath,
		stdin: 'ignore',
	});

	// await execa('npm', ['install', 'directus@preview', '--production', '--no-optional'], {
	// 	cwd: rootPath,
	// 	stdin: 'ignore',
	// });

	let { client } = await inquirer.prompt([
		{
			type: 'list',
			name: 'client',
			message: 'Choose your database client',
			choices: Object.values(drivers),
		},
	]);

	const dbClient = getDriverForClient(client)!;

	const credentials: Credentials = await inquirer.prompt(
		(databaseQuestions[dbClient] as any[]).map((question: Function) => question({ client }))
	);

	console.log(`

Installing database...

	`);

	const db = createDBConnection(dbClient, credentials);

	try {
		await db.seed.run();
	} catch (error) {
		console.log(`${chalk.red('Database Error')}: Couldn't install the database:`);
		console.log(error.message);
	}

	console.log(`

Creating the .env file...

	`);

	await createEnv(dbClient, credentials, rootPath);

	console.log(`

Create your first admin user:`);

	const firstUser = await inquirer.prompt([
		{
			type: 'input',
			name: 'email',
			message: 'Email',
			default: 'admin@example.com',
		},
		{
			type: 'password',
			name: 'password',
			message: 'Password',
			mask: '*',
		},
	]);

	firstUser.password = await argon2.hash(firstUser.password);
	const id = uuidV4();

	await db('directus_users').insert({
		id,
		email: firstUser.email,
		password: firstUser.password,
		first_name: 'Admin',
		last_name: 'User',
	});

	db.destroy();

	console.log(`
Your project has been created at ${chalk.green(rootPath)}.

Start Directus by running:
  ${chalk.blue('cd')} ${rootPath}
  ${chalk.blue('npx directus')} start
`);
}

function checkRequirements() {
	const nodeVersion = process.versions.node;
	const major = +nodeVersion.split('.')[0];

	if (major < 12) {
		console.error(`You are running Node ${nodeVersion}.`);
		console.error('Directus requires Node 12 and up.');
		console.error('Please update your Node version and try again.');
		process.exit(1);
	}
}
