/**
 * Sample library for the README demo recording (`record.ts`). It holds a few
 * well-known papers with BibTeX shaped like Zotero's own export, so the demo
 * looks like real use without showing anyone's actual library.
 */

import type { FakeItem, FakeLibrary } from '../fakeZotero';

/**
 * Builds a sample item whose BibTeX mirrors Zotero's export format.
 *
 * @param fields Item metadata; `authors` are "Last, First" strings.
 */
function paper(fields: {
  key: string;
  type: 'inproceedings' | 'article';
  title: string;
  bibTitle: string;
  authors: string[];
  venue: string;
  year: string;
}): FakeItem {
  const venueField = fields.type === 'inproceedings' ? 'booktitle' : 'journal';
  return {
    key: fields.key.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(8, 'X'),
    itemType: fields.type === 'inproceedings' ? 'conferencePaper' : 'journalArticle',
    title: fields.title,
    lastNames: fields.authors.map((a) => a.split(',')[0]),
    year: fields.year,
    collections: [],
    citeKey: fields.key,
    publicationTitle: fields.venue,
    bibtex: [
      '',
      `@${fields.type}{${fields.key},`,
      `\ttitle = {${fields.bibTitle}},`,
      `\t${venueField} = {${fields.venue}},`,
      `\tauthor = {${fields.authors.join(' and ')}},`,
      `\tyear = {${fields.year}},`,
      '}',
      '',
    ].join('\n'),
  };
}

export const DEMO_LIBRARY: FakeLibrary = {
  collections: [],
  items: [
    paper({
      key: 'vaswani_attention_2017',
      type: 'inproceedings',
      title: 'Attention Is All You Need',
      bibTitle: 'Attention {Is} {All} {You} {Need}',
      authors: [
        'Vaswani, Ashish', 'Shazeer, Noam', 'Parmar, Niki', 'Uszkoreit, Jakob',
        'Jones, Llion', 'Gomez, Aidan N.', 'Kaiser, Łukasz', 'Polosukhin, Illia',
      ],
      venue: 'Advances in Neural Information Processing Systems',
      year: '2017',
    }),
    paper({
      key: 'dosovitskiy_image_2021',
      type: 'inproceedings',
      title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale',
      bibTitle: 'An {Image} is {Worth} 16x16 {Words}: {Transformers} for {Image} {Recognition} at {Scale}',
      authors: [
        'Dosovitskiy, Alexey', 'Beyer, Lucas', 'Kolesnikov, Alexander', 'Weissenborn, Dirk',
        'Zhai, Xiaohua', 'Unterthiner, Thomas', 'Dehghani, Mostafa', 'Minderer, Matthias',
        'Heigold, Georg', 'Gelly, Sylvain', 'Uszkoreit, Jakob', 'Houlsby, Neil',
      ],
      venue: 'International Conference on Learning Representations',
      year: '2021',
    }),
    paper({
      key: 'radford_learning_2021',
      type: 'inproceedings',
      title: 'Learning Transferable Visual Models From Natural Language Supervision',
      bibTitle: 'Learning {Transferable} {Visual} {Models} {From} {Natural} {Language} {Supervision}',
      authors: [
        'Radford, Alec', 'Kim, Jong Wook', 'Hallacy, Chris', 'Ramesh, Aditya',
        'Goh, Gabriel', 'Agarwal, Sandhini', 'Sastry, Girish', 'Askell, Amanda',
        'Mishkin, Pamela', 'Clark, Jack', 'Krueger, Gretchen', 'Sutskever, Ilya',
      ],
      venue: 'International Conference on Machine Learning',
      year: '2021',
    }),
    paper({
      key: 'he_deep_2016',
      type: 'inproceedings',
      title: 'Deep Residual Learning for Image Recognition',
      bibTitle: 'Deep {Residual} {Learning} for {Image} {Recognition}',
      authors: ['He, Kaiming', 'Zhang, Xiangyu', 'Ren, Shaoqing', 'Sun, Jian'],
      venue: 'IEEE Conference on Computer Vision and Pattern Recognition',
      year: '2016',
    }),
    paper({
      key: 'devlin_bert_2019',
      type: 'inproceedings',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      bibTitle: '{BERT}: {Pre}-training of {Deep} {Bidirectional} {Transformers} for {Language} {Understanding}',
      authors: ['Devlin, Jacob', 'Chang, Ming-Wei', 'Lee, Kenton', 'Toutanova, Kristina'],
      venue: 'Proceedings of NAACL-HLT',
      year: '2019',
    }),
    paper({
      key: 'ho_denoising_2020',
      type: 'inproceedings',
      title: 'Denoising Diffusion Probabilistic Models',
      bibTitle: 'Denoising {Diffusion} {Probabilistic} {Models}',
      authors: ['Ho, Jonathan', 'Jain, Ajay', 'Abbeel, Pieter'],
      venue: 'Advances in Neural Information Processing Systems',
      year: '2020',
    }),
  ],
};

/** The project's existing bibliography before the demo starts. */
export const DEMO_REFS_BIB = [
  '@inproceedings{kingma_adam_2015,',
  '\ttitle = {Adam: {A} {Method} for {Stochastic} {Optimization}},',
  '\tbooktitle = {International Conference on Learning Representations},',
  '\tauthor = {Kingma, Diederik P. and Ba, Jimmy},',
  '\tyear = {2015},',
  '}',
  '',
].join('\n');

/** LaTeX source; the demo types into the empty line after the section. */
export const DEMO_PAPER_TEX = [
  '\\section{Related Work}',
  '',
  '',
  '',
  '\\bibliographystyle{plainnat}',
  '\\bibliography{refs}',
  '',
].join('\n');

/** Zero-based line the demo types on. */
export const DEMO_TYPING_LINE = 2;
