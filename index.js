'use strict';

const fs = require('fs');
const path = require('path');

const _ = require('lodash');
const Bluebird = require('bluebird');
const loaderUtils = require('loader-utils');

const BasicEvaluatedExpression = require('webpack/lib/BasicEvaluatedExpression');

const PLUGIN_NAME = 'TranslatePlugin';
const translationSymbol = require('./html-loader').symbol;

const translationFilePattern = /locales\/([^/]+)\/([^/]+)\.[^\.]+.json$/;
const translationVariantPattern = /_((\d+)|plural)$/;

function flatten(obj, result = {}, prefix = '') {
	_.forEach(obj, (v, k) => {
		if (_.isString(v)) {
			result[prefix + k] = v;
		} else {
			flatten(v, result, prefix + k + '.');
		}
	});
	return result;
}

class TranslatePlugin {
	constructor(options = {}) {
		this.srcFilename = options.src;
		this.destFilename = options.dest;
		this.indexFilename = options.index;
		this.createDiff = options.createDiff;
	}
	loadTranslation() {
		return Bluebird.fromCallback((callback) => {
			fs.readFile(this.srcFilename, callback);
		})
		.then(data => {
			this.baseTranslations = JSON.parse(data);
		});
	}
	apply(compiler) {
		compiler.hooks.run.tapPromise(PLUGIN_NAME, (__compiler) => this.loadTranslation());
		compiler.hooks.watchRun.tapPromise(PLUGIN_NAME, (__compiler) => this.loadTranslation());

		compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, factory => {
			factory.hooks.parser.for('javascript/auto').tap(PLUGIN_NAME, tapParser);
			factory.hooks.parser.for('javascript/dynamic').tap(PLUGIN_NAME, tapParser);
			factory.hooks.parser.for('javascript/esm').tap(PLUGIN_NAME, tapParser);

			function tapParser(parser) {
				parser.hooks.evaluateDefinedIdentifier.for('i18n.tr').tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for('this.i18n.tr').tap(PLUGIN_NAME, evaluateToi18n);
				// Workaround for aliases produced by babel
				parser.hooks.evaluateDefinedIdentifier.for('_this.i18n.tr').tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for('_this2.i18n.tr').tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for('_this3.i18n.tr').tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for('_this4.i18n.tr').tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for('_this5.i18n.tr').tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for('_this6.i18n.tr').tap(PLUGIN_NAME, evaluateToi18n);

				function evaluateToi18n(expression) {
					return new BasicEvaluatedExpression().setRange(expression.range).setIdentifier('i18n.tr');
				}

				parser.hooks.call.for('i18n.tr').tap(PLUGIN_NAME, (expression) => {
					const args = expression.arguments;
					if (args.length === 0) {
						return;
					}
					const keyArg = args[0];
					const valueArg = args.length >= 3 ? args[2] : args[0];
					const module = parser.state.current;
					if (keyArg.type !== 'Literal' || valueArg.type !== 'Literal') {
						const pos = expression.loc.start;
						parser.state.compilation.warnings.push(new Error(`Call to "i18n.tr" contains non-literal arguments:\n\t${module.resource} (line ${pos.line}, column ${pos.column})`));
						return;
					}
					if (!module[translationSymbol]) {
						module[translationSymbol] = [];
					}
					module[translationSymbol].push({key: keyArg.value, value: valueArg.value});
				});
			}
		});

		compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
			if (compilation.name) {
				// console.log('Child compilation', compilation.name);
				// We’re not interested in child compilations
				return;
			}

			const extractedTranslations = {};

			// compilation.hooks.succeedModule.tap(PLUGIN_NAME, (module) => {
			// 	console.log('Succeeded', module.request);
			// });
			compilation.hooks.seal.tap(PLUGIN_NAME, () => {
				// console.log('Sealed', compilation.name);
				compilation.modules.forEach((m) => addModuleTranslations(m));
			});
			compilation.hooks.additionalAssets.tapAsync(PLUGIN_NAME, (callback) => {
				if (this.createDiff) {
					const diff = {
						new: {},
						changed: {},
						removed: {},
					};
					const flatBaseTranslations = flatten(this.baseTranslations);
					_.forEach(flatBaseTranslations, (v, key) => {
						if (!extractedTranslations[key]) {
							if (!translationVariantPattern.test(key)) {
								_.set(diff.removed, key, v);
							}
						} else if (extractedTranslations[key] !== v) {
							_.set(diff.changed, key, extractedTranslations[key]);
						}
					});
					_.forEach(extractedTranslations, (v, key) => {
						if (!flatBaseTranslations[key]) {
							_.set(diff.new, key, v);
						}
					});
					const parsedSrc = path.parse(this.srcFilename);
					const diffFilename = path.join(parsedSrc.dir, `${parsedSrc.name}.diff.json`);
					fs.writeFileSync(diffFilename, JSON.stringify(diff, null, '\t'));
				}

				const translations = _.clone(this.baseTranslations);
				_.forEach(extractedTranslations, (value, key) => {
					_.set(translations, key, value);
				});

				if (Object.keys(translations).length) {
					// console.log(translations);
					const translationsStr = JSON.stringify(translations);
					const assetName = loaderUtils.interpolateName({resourcePath: this.srcFilename}, this.destFilename, {
						content: translationsStr,
					});
					// console.log('Creating asset', assetName);
					compilation.assets[assetName] = {
						source() {
							return translationsStr;
						},
						size() {
							return translationsStr.length;
						},
					};
				}
				callback();
			});

			function addModuleTranslations(module) {
				const moduleTranslations = module[translationSymbol];
				if (moduleTranslations) {
					moduleTranslations.forEach(({value, key}) => {
						if (key.indexOf('${') !== -1) {
							compilation.warnings.push(new Error(`Translation key "${key}" contains Aurelia interpolation`));
						}
						if (!value) {
							compilation.warnings.push(new Error(`Translation key "${key}" has no default value`));
						}
						const existing = extractedTranslations[key];
						if (existing && existing !== value) {
							compilation.warnings.push(new Error(`Translation key "${key}" has mismatching definitions:\n\t1. ${existing}\n\t2. ${value}`));
						}

						extractedTranslations[key] = value;
					});
				}
			}
		});

		const translationFiles = {};
		compiler.hooks.emit.tapAsync(PLUGIN_NAME, (compilation, callback) => {
			_.forEach(compilation.assets, (__v, name) => {
				const match = translationFilePattern.exec(name);
				if (match) {
					const lang = match[1];
					const ns = match[2];
					if (!translationFiles[lang]) {
						translationFiles[lang] = {};
					}
					translationFiles[lang][ns] = name;
				}
			});

			// console.log(this.indexFilename, translationFiles);

			const translationFilesStr = JSON.stringify(translationFiles);
			compilation.assets[this.indexFilename] = {
				source() {
					return translationFilesStr;
				},
				size() {
					return translationFilesStr.length;
				},
			};
			callback();
		});
	}
}

TranslatePlugin.HtmlLoader = require.resolve('./html-loader');

module.exports = TranslatePlugin;
