'use strict';

const fs = require('fs');
const path = require('path');

const _ = require('lodash');
const Bluebird = require('bluebird');
const loaderUtils = require('loader-utils');

const BasicEvaluatedExpression = require('webpack/lib/BasicEvaluatedExpression');

const PLUGIN_NAME = 'I18nextTranslatePlugin';
const htmlTranslationSymbol = require('./html-loader').symbol;
const jsTranslationSymbol = Symbol('JS i18next translations');

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
		this.duplicateWarnings = options.duplicateWarnings;
		this.i18nFunctionName = options.i18nFunctionName || 'i18next.t';
		this.excludePaths = options.excludePaths || [path.resolve('./node_modules')];
		this.translationFilePattern = options.translationFilePattern || /locales\/([^/]+)\/([^/]+)\.[^\.]+.json$/;
	}
	loadTranslation() {
		return Bluebird.fromCallback((callback) => {
			fs.readFile(this.srcFilename, callback);
		})
		.then(
			data => {
				this.baseTranslations = JSON.parse(data);
			},
			() => {
				this.baseTranslations = {};
			}
		);
	}
	apply(compiler) {
		compiler.hooks.run.tapPromise(PLUGIN_NAME, (__compiler) => this.loadTranslation());
		compiler.hooks.watchRun.tapPromise(PLUGIN_NAME, (__compiler) => this.loadTranslation());

		// Tap the JS parser to find all calls to the translation function
		compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, factory => {
			const tapParser = (parser) => {
				const evaluateToi18n = (expression) => {
					return new BasicEvaluatedExpression().setRange(expression.range).setIdentifier(this.i18nFunctionName);
				};

				parser.hooks.evaluateDefinedIdentifier.for(this.i18nFunctionName).tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for(`this.${this.i18nFunctionName}`).tap(PLUGIN_NAME, evaluateToi18n);
				// @ToDo, @Cleanup: Messy workaround for aliases produced by babel.
				// Unfortunately, we can’t subscribe to something more general.
				parser.hooks.evaluateDefinedIdentifier.for(`_this.${this.i18nFunctionName}`).tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for(`_this2.${this.i18nFunctionName}`).tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for(`_this3.${this.i18nFunctionName}`).tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for(`_this4.${this.i18nFunctionName}`).tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for(`_this5.${this.i18nFunctionName}`).tap(PLUGIN_NAME, evaluateToi18n);
				parser.hooks.evaluateDefinedIdentifier.for(`_this6.${this.i18nFunctionName}`).tap(PLUGIN_NAME, evaluateToi18n);

				parser.hooks.call.for(this.i18nFunctionName).tap(PLUGIN_NAME, (expression) => {
					const args = expression.arguments;
					if (args.length === 0) {
						return;
					}
					const keyArg = args[0];
					const valueArg = args.length >= 3 ? args[2] : '';
					const module = parser.state.current;
					for (const excludePath of this.excludePaths) {
						if (_.startsWith(module.resource, excludePath)) {
							return;
						}
					}
					if (keyArg.type !== 'Literal' || valueArg && valueArg.type !== 'Literal') {
						const pos = expression.loc.start;
						parser.state.compilation.warnings.push(new Error(`Call to "${this.i18nFunctionName}" contains non-literal arguments:\n\t${module.resource} (line ${pos.line}, column ${pos.column})`));
						return;
					}
					if (!module[jsTranslationSymbol]) {
						module[jsTranslationSymbol] = [];
					}
					module[jsTranslationSymbol].push({key: keyArg.value, value: valueArg && valueArg.value});
				});
			};

			factory.hooks.parser.for('javascript/auto').tap(PLUGIN_NAME, tapParser);
			factory.hooks.parser.for('javascript/dynamic').tap(PLUGIN_NAME, tapParser);
			factory.hooks.parser.for('javascript/esm').tap(PLUGIN_NAME, tapParser);
		});

		compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
			if (compilation.name) {
				// We’re not interested in child compilations
				return;
			}

			const extractedTranslations = {};
			const translationValues = {};

			compilation.hooks.buildModule.tap(PLUGIN_NAME, (module) => {
				delete module[jsTranslationSymbol];
			});
			compilation.hooks.seal.tap(PLUGIN_NAME, () => {
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
					if (!fs.existsSync(parsedSrc.dir)) {
						fs.mkdirSync(parsedSrc.dir);
					}
					const diffFilename = path.join(parsedSrc.dir, `${parsedSrc.name}.diff.json`);
					fs.writeFileSync(diffFilename, JSON.stringify(diff, null, '\t'));
				}

				const translations = _.clone(this.baseTranslations);
				_.forEach(extractedTranslations, (value, key) => {
					const parts = key.split('.');
					let parent = translations;
					while (parts.length > 1) {
						const path = parts.shift();
						if (!parent[path]) {
							parent[path] = {};
						} else if (_.isString(parent[path])) {
							const suffx = parts.join('.');
							const parentPath = key.substr(0, key.length - suffx.length - 1);
							compilation.errors.push(new Error(`Translation key "${key}" cannot be used because the parent ${parentPath} is already in use.`));
							return;
						}
						parent = parent[path];
					}
					const path = parts[0];
					if (parent[path] && !_.isString(parent[path])) {
						const subkeys = _.keys(parent[path]).map((k) => `${key}.${k}`);
						compilation.errors.push(new Error(`Translation key "${key}" cannot be used because there are already sub-keys:\n\t${subkeys.join('\n\t')}`));
						return;
					}
					parent[path] = value;
				});

				if (this.duplicateWarnings) {
					_.forEach(translationValues, (keys, value) => {
						if (keys.size > 1) {
							compilation.warnings.push(new Error(`There are multiple keys for translation "${value}":\n\t${Array.from(keys).join('\n\t')}`));
						}
					});
				}

				// Patch the current translation asset to have new keys available without having to modify the translation file.
				if (Object.keys(translations).length) {
					const translationsStr = JSON.stringify(translations);
					const assetName = loaderUtils.interpolateName({resourcePath: this.srcFilename}, this.destFilename, {
						content: translationsStr,
					});
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
				if (module[htmlTranslationSymbol]) {
					module[htmlTranslationSymbol].forEach(addTranslation);
				}
				if (module[jsTranslationSymbol]) {
					module[jsTranslationSymbol].forEach(addTranslation);
				}
			}

			function addTranslation({value, key}) {
				if (key.indexOf('${') !== -1) {
					compilation.warnings.push(new Error(`Translation key "${key}" contains non-i18next interpolation`));
				}
				if (!value) {
					compilation.warnings.push(new Error(`Translation key "${key}" has no default value`));
					value = key;
				}
				const existing = extractedTranslations[key];
				if (existing && existing !== value) {
					compilation.warnings.push(new Error(`Translation key "${key}" has mismatching definitions:\n\t1. ${existing}\n\t2. ${value}`));
				} else {
					extractedTranslations[key] = value;
				}
				if (!translationValues[value]) {
					translationValues[value] = new Set();
				}
				translationValues[value].add(key);
			}
		});

		const translationFiles = {};
		compiler.hooks.emit.tapAsync(PLUGIN_NAME, (compilation, callback) => {
			_.forEach(compilation.assets, (asset, name) => {
				const match = this.translationFilePattern.exec(name);
				if (match) {
					// Check translation files for syntax errors. (otherwise i18next may fail silently)
					try {
						JSON.parse(asset.source());
					} catch (e) {
						compilation.errors.push(new Error(`Translation file ${name} is not valid JSON: ${e.message}`));
					}

					const lang = match[1];
					const ns = match[2];
					if (!translationFiles[lang]) {
						translationFiles[lang] = {};
					}
					translationFiles[lang][ns] = name;
				}
			});

			const translationFilesStr = JSON.stringify(translationFiles);
			if (this.indexFilename) {
				compilation.assets[this.indexFilename] = {
					source() {
						return translationFilesStr;
					},
					size() {
						return translationFilesStr.length;
					},
				};
			}

			callback();
		});
	}
}

TranslatePlugin.HtmlLoader = require.resolve('./html-loader');

module.exports = TranslatePlugin;
