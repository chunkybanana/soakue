importScripts("data/toakue.js");

let escapeHTML = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let error = (words, err) => ({ err: words.join(`« <code>${escapeHTML(err)}</code> »`) });

function search(q) {
    let terms = q.split(" ");

    terms = terms.map(term => {
        let [_, operator, query] = term.match(/^(==|[=~@#/$!^-]|[a-z]*:)(.*)/) ?? [];
        if (!operator) return { op: "", orig: term, value: term.toLowerCase() };

        let colon = operator.endsWith(":");
        operator = operator.replace(/:$/, "");

        const operators = ["head", "body", "user", "score", "id", "scope", "arity", "not"];
        if (colon && !operators.includes(operator))
            return error`bu jıq mıjóaıchase ${operator}`;

        if (["/", "arity"].includes(operator) && !/^[0-9]?$/.test(query))
            return error`bu tıozıu mí ${query} (kïo tıao máo kóam kı)`;

        if (["^", "score"].includes(operator) && isNaN(query.replace(/^=/, "")))
            return error`bu zıu mí ${query.replace(/^=/, "")}`;

        if (["head", "=", "~"].includes(operator)) {
            let regex = queryToRegex(query);
            if (regex.err) return regex;
        }

        return {
            op: operator,
            orig: query,
            value: query.toLowerCase()
        };
    });

    let err = terms.find(t => t.err);
    if (err) return err;

    let excluded = terms
        .filter(t => ["!", "-", "not"].includes(t.op))
        .map(t => search(t.orig));

    err = excluded.find(e => e.err);
    if (err) return err;
    excluded = new Set(excluded.flat().map(e => e[0].id));

    let res = [];
    for (const entry of dict) {
        if (excluded.has(entry.id)) continue;

        const arity = Math.max(...entry.body.split(/[;.?!]/).map(b => b.split("▯").length - 1));

        // Each term is mapped to the baseline score from that term type, or undefined if it doesn't match

        let scores = terms.map(({ op, orig, value }) => {
            // 6: id
            if (["#", "id"].includes(op) && entry.id == orig) return 6;

            // 5: head
            if (["=", "head", "~", ""].includes(op) && compareish(normalize(value), normalize(entry.head))) return 5.2;
            if (!op && compareish(normalizeToneless(value), normalizeToneless(entry.head))) return 5.1;

            // and regex matching
            if (["=", "head", "~"].includes(op)) {
                let regex = queryToRegex(_normalize(orig), op != '~');
                //console.log(regex);
                if (regex.test(normalize(entry.head))) return 5;
            }

            // 3: body
            if (["body", ""].includes(op)) {
                const v = normalize(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const body = normalize(entry.body);

                if (RegExp(`▯ ?(is|are)?( an?)? ([^ /▯]+/)*${v}`, "iu").test(body)) return 3.2
                if (RegExp(`([^'’]\\b|(?!['’])\\W|^)${v}`, "iu").test(body)) return 3.1
                if (body.includes(normalize(value))) return 3;
            }

            // 1-2: no op
            if (!op) {
                if (entry.notes.some(n => normalize(n.content).includes(normalize(value)))) return 2;
                if (normalize(entry.head).startsWith(normalize(value))) return 1.1;
                if (normalizeToneless(entry.head).includes(normalizeToneless(value))) return 1;
            }

            // other
            if (
                ["@", "user"].includes(op) && entry.user.toLowerCase() == value.toLowerCase()
                || ["$", "scope"].includes(op) && entry.scope.toLowerCase() == value.toLowerCase()
                || ["/", "arity"].includes(op) && value == arity
                || ["^", "score"].includes(op) && (entry.score >= value || entry.score == value.replace(/^=/, ""))
                || ["!", "-", "not"].includes(op)
            ) return 0.1;
        })

        if (scores.some(s => !s)) continue;

        let bonus = entry.user == "official" ? 0.3 :
            entry.user == "oldofficial" || /^(old)?(countries|examples)$/.test(entry.user) ? -0.3 : 0;
        bonus += entry.score / 20;
        res.push([entry, Math.max(...scores) + bonus]);
    }
    return res.sort((a, b) => b[1] - a[1]);
}

const tones = `\u0300\u0301\u0308\u0302`;
const underdot = `\u0323`;
const vowels = `aeıou`;

const char_match = `(?:.[${tones}]?${underdot}?)`;
const vowel_match = `(?:[${vowels}][${tones}]?${underdot}?)`;
const init_consonants = `(?:[mpbfntdczsrljꝡkg'h]|[ncs]h)`;
const letter = `(?:${vowel_match}|${init_consonants}|q)`;
const finals = `[mq]`;
const diphthongs = `([aeo]ı|ao)`;

const raku = `((?<= |^)|${init_consonants})${vowel_match}?(${diphthongs}|${vowel_match}${finals}?)`;

let substitutions = {
    '*': '.*',
    '?': letter,
    'C': init_consonants,
    'V': vowel_match,
    'F': diphthongs,
    'Q': finals,
    'R': raku,
    '_': ' ',
}

// If a tone is present in the query, it's required in the word; if not present any tone(s) are allowed.
// Underdots are dealt with separately, so query nạbie matches word nạ́bıe
for (let vowel of vowels) {
    substitutions[vowel] = `${vowel}[${tones}]?${underdot}?`
    substitutions[vowel + underdot] = `${vowel}[${tones}]?${underdot}`
    for (let tone of tones) {
        substitutions[vowel + tone] = `${vowel}${tone}${underdot}?`
    }
}

const word_diacritic_regex = new RegExp(`(${letter}+)([1234])`, "iug");
const diacritic_tones = {
    '1': '\u0300',
    '2': '\u0301',
    '3': '\u0308',
    '4': '\u0302',
}
const vowel_regex = new RegExp(`${vowel_match}`, "iu");
const underdot_regex = new RegExp(`(${raku})([\.])`, "iug");

const isTone = c => /^[\u0300\u0301\u0308\u0302\u0323]$/.test(c);

const normalizeToneless = w => [...normalize(w)].filter(c => !isTone(c)).join("");

// for regex sarch purposes, we don't want to convert to lowercase since C/F/Q/R/V exist
const _normalize = w => w.normalize("NFD")
    .replace(/i/g, "ı")
    .replace(/[vw]/g, "ꝡ")
    .replace(/[x‘’]/g, "'")
    .replace(/\u0323([\u0301\u0308\u0302])/, "$1\u0323")
    .replace(word_diacritic_regex, (_, word, number) =>
        word.replace(vowel_regex, c => c + diacritic_tones[number])
    ).replace(underdot_regex, (_, word) =>
        word.replace(vowel_regex, c => c + underdot)
    )

const normalize = w => _normalize(w.toLowerCase())

// handle prefix hyphens
const compareish = (query, word) => query == word || query == word.replace(/-$/, "");

const char_regex = new RegExp(`${char_match}`, "iug");
const char_brackets_regex = new RegExp(`\\[${char_match}*?\\]`, "iug");

// I don't know how much performance impact compiling 25000 regexes would have but better safe than sorry
const cache = new Map();
const queryToRegex = (query, anchored = true) => {
    let hash = query + anchored;
    if (cache.has(hash)) return cache.get(hash);
    // due to [...] not being true character classes, we can't directly substitute them
    // and instead have to turn [abc] into (a|b|c)
    let compiled = query
        .replace(char_brackets_regex, c => `(${c.slice(1, -1).match(char_regex)?.join("|") ?? ''})`)
        .replace(char_regex, c => substitutions[c] ?? c)

    // Rather than attempting to deal with invalid regexes manually, just let javascript barf if something goes wrong
    // -? is added to the end to allow for prefix hyphens
    try {
        let regex = new RegExp(anchored ? `^(${compiled})-?$` : `(${compiled})-?`, "ui");
        cache.set(hash, regex);
        return regex;
    } catch (e) {
        return error`bu sekogeq mí ${query}`;
    }
}

onmessage = e => {
    var q = e.data.q;
    var res = search(q);
    postMessage(res);
}
