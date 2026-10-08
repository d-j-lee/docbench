// <script src="docbench.iife.js"> 로 넣었을 때 window.DocBench 로 노출되고 <doc-bench> 가 등록된다
import { defineElement } from './index';
export * from './index';
defineElement();
