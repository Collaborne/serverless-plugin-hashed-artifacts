const { createHash } = require('crypto');
const { createReadStream, createWriteStream, rename } = require('fs');
const { basename, dirname, extname, resolve: resolvePath } = require('path');

const { uploadCloudFormationFile } = require('serverless/lib/plugins/aws/deploy/lib/uploadArtifacts.js');

/**
 * Whether the provider naming can be reconfigured to keep the compiled template in a timestamped directory
 *
 * @see <https://github.com/serverless/serverless/pull/9926>
 */
const CAN_RECONFIGURE_COMPILED_TEMPLATE_S3_SUFFIX = false;

/**
 * Plugin to configure function artifacts and `service.package.artifactDirectoryName` based on a hash of their contents
 *
 * @see {lib/plugins/aws/package/lib/generateArtifactDirectoryName.js}
 * @type {import('serverless/classes/Plugin')}
 */
class HashedArtifactsPlugin {
	/**
	 *
	 * @param {import('serverless')} serverless
	 * @param {import('serverless').Options} options
	 */
	constructor(serverless, options) {
		this.serverless = serverless;
		this.options = options;
		this.provider = this.serverless.getProvider('aws');
		this.hooks = {
			'after:package:createDeploymentArtifacts': async () => {
				await this.prepareHashedArtifactDirectoryName();
			},
			'after:aws:deploy:deploy:uploadArtifacts': async () => {
				if (!CAN_RECONFIGURE_COMPILED_TEMPLATE_S3_SUFFIX) {
					// Replicate "setBucketName"
					// XXX: `uploadCloudFormationFile` could just read the name of the bucket object _it already has!_
					const bucketName = await this.provider.getServerlessDeploymentBucketName();
					this.bucketName = bucketName;

					// Update the template again with a changed suffix, and then restore the original naming.
					// This should make it possible for `rollback` to see the template to restore.
					const cleanup = this.reconfigureCompiledTemplateS3Suffix();
					try {
						await uploadCloudFormationFile.call(this);
					} finally {
						cleanup();
					}
				}
			}
		};
	}

	async prepareHashedArtifactDirectoryName() {
		if (this.serverless.service.package.artifactDirectoryName) {
			// Too late!
			this.serverless.cli.log(
				`Cannot configure artifact directory name, already set to ${this.serverless.service.package.artifactDirectoryName}`,
			);
			return;
		}

		if (
			typeof this.provider.naming.getCompiledTemplateS3Suffix !== 'function'
		) {
			this.serverless.cli.log(`Incompatible version of the AWS provider`);
			return;
		}

		// Walk over all functions defined, and collect the paths to their artifacts. Iff any
		// function doesn't provide that (i.e. must be compiled by serverless itself), then we bail.
		// Otherwise we sort the artifacts, hash them, and generate the artifact directory name based
		// on that.
		const allFunctions = this.serverless.service.getAllFunctions();
		const artifactPromises = allFunctions.map(async functionName => {
			const functionObject = this.serverless.service.getFunction(functionName);
			if (functionObject.image) {
				// Ignore functions pointing to an AMI/ready-made-deployment image
				return undefined;
			}

			functionObject.package = functionObject.package || {};
			if (functionObject.package.disable) {
				// Ignore functions that shouldn't be packaged at all
				return undefined;
			}

			if (functionObject.package.artifact) {
				return functionObject;
			}

			throw new Error(
				`Function ${functionName} requires packaging by serverless`,
			);
		});

		try {
			const functionObjectsToProcess = await Promise.all(artifactPromises);
			// Looks like things are fine, so lets move things and adjust the paths
			// When serverless uploads the files all will be good, and it will just overwrite the files
			// with the same hash. Later on CloudFormation will see that the hash didn't change, and not further touch
			// things.
			for (const functionObject of functionObjectsToProcess) {
				const movedArtifact = await this.moveToHashed(
					functionObject.package.artifact,
				);
				this.serverless.cli.log(
					`Moved ${functionObject.package.artifact} to ${movedArtifact}`,
				);
				functionObject.package.artifact = movedArtifact;
			}
			// Still good, so fix up the rest:
			const serviceStage = `${
				this.serverless.service.service
			}/${this.provider.getStage()}`;
			const prefix = this.provider.getDeploymentPrefix();

			const artifactDirectoryName = `${prefix}/${serviceStage}`;
			this.serverless.cli.log(
				`Setting artifact directory name to ${artifactDirectoryName}`,
			);
			this.serverless.service.package.artifactDirectoryName = artifactDirectoryName;

			// Keep the template itself in a by-date location by monkey-patching into the naming
			if (CAN_RECONFIGURE_COMPILED_TEMPLATE_S3_SUFFIX) {
				this.reconfigureCompiledTemplateS3Suffix();
			} else {
				this.serverless.cli.log(
					`Cannot reconfigure the path to the compiled template, rollbacks are unavailable`,
				);
			}
		} catch (err) {
			this.serverless.cli.log(
				`Cannot use hashing for artifact directory name: ${err}`,
			);
		}
	}

	/**
	 *
	 * @param {string} artifact artifact to move
	 * @param {string} [outputDir] directory for moving the artifact to
	 * @param {string} [algorithm] algorithm to use for hashing
	 * @returns {Promise<string>}
	 */
	async moveToHashed(
		artifact,
		outputDir = dirname(artifact),
		algorithm = 'sha1',
	) {
		const artifactFileExt = extname(artifact);
		const artifactFileBasename = basename(artifact, artifactFileExt);
		const tmpOutputPath = resolvePath(outputDir, `${artifactFileBasename}.tmp`);

		const hash = createHash(algorithm);
		return new Promise((resolve, reject) => {
			const stream = createReadStream(artifact);
			const outputStream = createWriteStream(tmpOutputPath);
			stream.on('error', err => {
				reject(err);
			});
			stream.on('data', chunk => {
				hash.update(chunk);
				outputStream.write(chunk, err => {
					if (err) {
						this.serverless.cli.log(
							`Cannot write chunk to ${tmpOutputPath}: ${err.message}`,
						);
						reject(err);
					}
				});
			});
			stream.on('end', () => {
				const digest = hash.digest('hex');
				const outputPath = resolvePath(
					outputDir,
					`${artifactFileBasename}-${digest}${artifactFileExt}`,
				);
				rename(tmpOutputPath, outputPath, () => {
					resolve(outputPath);
				});
			});
		});
	}

	reconfigureCompiledTemplateS3Suffix(naming = this.provider.naming) {
		const date = new Date();
		const dateString = `${date.getTime().toString()}-${date.toISOString()}`;
		const originalGetCompiledTemplateS3Suffix = naming.getCompiledTemplateS3Suffix;
		naming.getCompiledTemplateS3Suffix = () =>
			`${dateString}/${originalGetCompiledTemplateS3Suffix.call(naming)}`;
		return () => {
			naming.getCompiledTemplateS3Suffix = originalGetCompiledTemplateS3Suffix;
		};
	}
}

module.exports = HashedArtifactsPlugin;
