'use strict';

const cheerio = require('cheerio');

function findTranslations(html) {
	return new Promise((resolve) => {
		const $ = cheerio.load(html, {
			xml: {
				xmlMode: false,
			}
		});
		const template =  $('template');
		if (template.length) {
			$('body').html(template.html());
		}
		const translations = [];
		$('[t]').each((__i, el) => {
			parseTranslations($(el)).forEach(({key, value}) => {
				if (value && value.indexOf('${') !== -1) {
					this.emitWarning(new Error(`Translation key "${key}" contains Aurelia interpolation:\n\t${value}`));
				}
				translations.push({key, value});
			});
		});
		resolve(translations);
	});
}

const attrExp = /\[([a-z\-]*)\]/i;

function parseTranslations(element) {
	const keys = element.attr('t').split(';');
	return keys.map((key) => {
		let attr = element.is('img') ? 'src' : 'text';
		// check if a attribute was specified in the key
		const match = attrExp.exec(key);
		if (match) {
			key = key.replace(match[0], '');
			attr = match[1];
		}

		let value;
		switch (attr) {
			case 'text':
				value = element.text().trim();
				break;
			case 'prepend':
			case 'append':
			case 'html':
				value = element.html().trim();
				break;
			default:
				value = element.attr(attr);
				break;
		}
		return {key, value};
	});
}

const transSymbol = Symbol('HTML translations');

function htmlTranslationLoader(content) {
	// console.log('Looking for translations in ', this._module.request);
	if (this.cacheable) {
		this.cacheable();
	}
	const callback = this.async();
	return findTranslations.call(this, content)
	.then(translations => {
		// console.log('Found', translations.length);
		this._module[transSymbol] = translations;
		callback(null, content);
	})
	.catch(callback);
}
htmlTranslationLoader.symbol = transSymbol;

module.exports = htmlTranslationLoader;
