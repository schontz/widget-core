const { describe, it, beforeEach, afterEach } = intern.getInterface('bdd');
const { assert } = intern.getPlugin('chai');
import { spy, stub, SinonStub } from 'sinon';

import { WidgetBase, noBind } from './../../src/WidgetBase';
import { v } from './../../src/d';
import { WIDGET_BASE_TYPE } from './../../src/Registry';
import { VNode, WidgetMetaConstructor, WidgetMetaBase } from './../../src/interfaces';
import { handleDecorator } from './../../src/decorators/handleDecorator';
import { diffProperty } from './../../src/decorators/diffProperty';
import { Registry } from './../../src/Registry';
import { Base } from './../../src/meta/Base';
import { NodeEventType } from './../../src/NodeHandler';
import { widgetInstanceMap } from './../../src/vdom';
import { afterRender } from '../../src/decorators/afterRender';

interface TestProperties {
	foo?: string;
	bar?: boolean;
	baz?: Function;
	qux?: object;
	quux?: any[];
	foobar?: number;
}

class TestMeta extends Base {
	public widgetEvent = false;

	constructor(options: any) {
		super(options);
		this.nodeHandler.on(NodeEventType.Widget, () => {
			this.widgetEvent = true;
		});
	}

	get(key: string | number) {
		return this.getNode(key);
	}
}

class BaseTestWidget extends WidgetBase<TestProperties> {
	public meta<T extends WidgetMetaBase>(metaType: WidgetMetaConstructor<T>) {
		return super.meta(metaType) as T;
	}

	public render() {
		return super.render();
	}

	callGetDecorator(decoratorKey: string) {
		return this.getDecorator(decoratorKey);
	}
}

function testDecorator(func?: Function) {
	return handleDecorator((target, propertyKey) => {
		target.addDecorator('test-decorator', func);
	});
}

let consoleStub: SinonStub;

describe('WidgetBase', () => {
	beforeEach(() => {
		consoleStub = stub(console, 'warn');
	});

	afterEach(() => {
		consoleStub.restore();
	});

	it('default render returns a `div` with the current widgets children', () => {
		const widget = new BaseTestWidget();
		widget.__setChildren__(['child']);
		const renderResult = widget.render() as VNode;
		assert.strictEqual(renderResult.tag, 'div');
		assert.deepEqual(renderResult.properties, {});
		assert.lengthOf(renderResult.children!, 1);
		assert.strictEqual(renderResult.children![0], 'child');
	});

	it('instance data invalidate is called on invalidate', () => {
		const child = new BaseTestWidget();
		const invalidateStub = stub();
		const instanceData = widgetInstanceMap.get(child)!;
		instanceData.invalidate = invalidateStub;
		child.invalidate();
		assert.isTrue(invalidateStub.calledOnce);
		child.invalidate();
		assert.isTrue(invalidateStub.calledTwice);
	});

	it('updated core properties available on instance data', () => {
		const child = new BaseTestWidget();
		const instanceData = widgetInstanceMap.get(child)!;
		assert.deepEqual(instanceData.coreProperties, {});
		child.__setCoreProperties__({ bind: child, baseRegistry: 'base' });
		assert.deepEqual(instanceData.coreProperties, { bind: child, baseRegistry: 'base' });
	});

	describe('__render__', () => {
		it('returns render result', () => {
			class TestWidget extends BaseTestWidget {
				render() {
					return v('my-app', ['child']);
				}
			}
			const widget = new TestWidget();
			const renderResult = widget.__render__() as VNode;
			assert.strictEqual(renderResult.tag, 'my-app');
			assert.lengthOf(renderResult.children!, 1);
			assert.strictEqual(renderResult.children![0], 'child');
		});
	});

	describe('__setProperties__', () => {
		it('diffs properties using `auto` strategy by default', () => {
			const widget = new BaseTestWidget();
			const invalidateSpy = spy(widget, 'invalidate');

			function baz() {}
			const qux = {
				foo: 'bar',
				bar: 'foo'
			};
			const quux = [1, 2, 3, 4];

			widget.__setProperties__({
				foo: 'bar',
				bar: true,
				baz,
				qux,
				quux
			});

			assert.isTrue(invalidateSpy.calledOnce);
			assert.deepEqual(widget.changedPropertyKeys, ['foo', 'bar', 'qux', 'quux']);

			widget.__setProperties__({
				foo: 'bar',
				bar: true,
				baz,
				qux,
				quux
			});

			assert.isTrue(invalidateSpy.calledOnce);
			assert.deepEqual(widget.changedPropertyKeys, []);

			widget.__setProperties__({
				foo: 'bar',
				bar: true,
				baz,
				quux
			});

			assert.isTrue(invalidateSpy.calledTwice);
			assert.deepEqual(widget.changedPropertyKeys, ['qux']);
		});

		it('Supports custom diffProperty function', () => {
			function customDiff(previousValue: any = 0, newValue: any) {
				return {
					changed: true,
					value: previousValue + newValue
				};
			}
			@diffProperty('foobar', customDiff)
			class TestWidget extends BaseTestWidget {}
			const widget = new TestWidget();
			const invalidateSpy = spy(widget, 'invalidate');

			widget.__setProperties__({ foobar: 2 });
			assert.isTrue(invalidateSpy.calledOnce);
			assert.deepEqual(widget.changedPropertyKeys, ['foobar']);
			assert.strictEqual(widget.properties.foobar, 2);

			widget.__setProperties__({ foobar: 4 });
			assert.isTrue(invalidateSpy.calledTwice);
			assert.deepEqual(widget.changedPropertyKeys, ['foobar']);
			assert.strictEqual(widget.properties.foobar, 6);

			widget.__setProperties__({});
			assert.isTrue(invalidateSpy.calledThrice);
			assert.deepEqual(widget.changedPropertyKeys, ['foobar']);
			assert.isUndefined(widget.properties.foobar);
		});

		it('Automatically binds functions properties', () => {
			class TestWidget extends BaseTestWidget {
				public called = false;
			}

			function baz(this: TestWidget) {
				this.called = true;
			}

			const widget = new TestWidget();

			widget.__setCoreProperties__({ bind: widget } as any);
			widget.__setProperties__({ baz });
			widget.properties.baz && widget.properties.baz();
			assert.isTrue(widget.called);
		});

		it('does not bind function properties that carry the dojo no bind symbol', () => {
			class TestWidget extends BaseTestWidget {
				public called = false;
			}

			function baz(this: any) {
				this.called = true;
			}

			(baz as any)[noBind] = true;

			const widget = new TestWidget();

			widget.__setCoreProperties__({ bind: widget } as any);
			widget.__setProperties__({ baz });
			widget.properties.baz && widget.properties.baz();
			assert.isFalse(widget.called);
		});

		it('Does not bind Widget constructor properties', () => {
			const widgetConstructorSpy: any = function(this: any) {
				this.functionIsBound = true;
			};
			widgetConstructorSpy._type = WIDGET_BASE_TYPE;

			class TestWidget extends WidgetBase<any> {
				functionIsBound = false;

				public callWidgetSpy() {
					this.properties.widgetConstructorSpy();
				}
			}

			const testWidget = new TestWidget();
			const properties = {
				widgetConstructorSpy,
				functionIsBound: false
			};
			testWidget.__setProperties__(properties);
			testWidget.callWidgetSpy();
			assert.isFalse(testWidget.functionIsBound);
			assert.isTrue(testWidget.properties.functionIsBound);
		});

		it('properties are only diffed once', () => {
			let diffCounter = 0;
			function testDiff(previousProperty: any, newProperty: any) {
				diffCounter++;
				return {
					value: newProperty,
					changed: false
				};
			}

			@diffProperty('foo', testDiff)
			@diffProperty('bar', testDiff)
			@diffProperty('baz', testDiff)
			class TestWidget extends WidgetBase<any> {}
			const testWidget = new TestWidget();
			const properties = {
				foo: 'foo',
				bar: 'bar',
				baz: 'baz'
			};
			testWidget.__setProperties__(properties);
			assert.strictEqual(diffCounter, 3);
			testWidget.__setProperties__(properties);
			assert.strictEqual(diffCounter, 6);
		});
	});

	it('__setChildren__', () => {
		const widget = new BaseTestWidget();
		const invalidateSpy = spy(widget, 'invalidate');
		widget.__setChildren__([]);
		assert.isTrue(invalidateSpy.notCalled);
		widget.__setChildren__(['child']);
		assert.isTrue(invalidateSpy.calledOnce);
		widget.__setChildren__(['child']);
		assert.isTrue(invalidateSpy.calledTwice);
		widget.__setChildren__([]);
		assert.isTrue(invalidateSpy.calledThrice);
		widget.__setChildren__([]);
		assert.isTrue(invalidateSpy.calledThrice);
	});

	describe('__setCoreProperties__', () => {
		it('new baseRegistry is added to RegistryHandler and triggers an invalidation', () => {
			const baseRegistry = new Registry();
			const injector = () => 'item';
			baseRegistry.defineInjector('label', () => injector);
			const widget = new BaseTestWidget();
			const invalidateSpy = spy(widget, 'invalidate');
			widget.__setCoreProperties__({ bind: widget, baseRegistry });
			assert.isTrue(invalidateSpy.calledOnce);
			assert.strictEqual(widget.registry.getInjector('label')!.injector, injector);
		});

		it('The same baseRegistry does not causes an invalidation', () => {
			const baseRegistry = new Registry();
			const widget = new BaseTestWidget();
			widget.__setCoreProperties__({ bind: widget, baseRegistry });
			const invalidateSpy = spy(widget, 'invalidate');
			widget.__setCoreProperties__({ bind: widget, baseRegistry });
			assert.isTrue(invalidateSpy.notCalled);
		});

		it('different baseRegistry replaces the RegistryHandlers baseRegistry and triggers an invalidation', () => {
			const baseRegistry = new Registry();
			const injector = () => 'item';
			baseRegistry.defineInjector('label', () => injector);
			const widget = new BaseTestWidget();
			widget.__setCoreProperties__({ bind: widget, baseRegistry: new Registry() });
			assert.isNull(widget.registry.getInjector('label'));
			const invalidateSpy = spy(widget, 'invalidate');
			widget.__setCoreProperties__({ bind: widget, baseRegistry });
			assert.strictEqual(widget.registry.getInjector('label')!.injector, injector);
			assert.isTrue(invalidateSpy.called);
		});
	});

	it('destroys registry when WidgetBase is detached', () => {
		const widget = new BaseTestWidget();
		const registry = widget.registry;
		const instanceData = widgetInstanceMap.get(widget)!;
		instanceData.onDetach();
		assert.throws(() => {
			registry.own({ destroy() {} });
		}, 'Call made to destroyed method');
	});

	describe('meta', () => {
		it('meta providers are cached', () => {
			const widget = new BaseTestWidget();
			const meta = widget.meta(Base);
			assert.strictEqual(meta, widget.meta(Base));
		});

		it('elements are added to node handler on create', () => {
			const element = {} as Element;
			const key = '1';
			const widget = new BaseTestWidget();
			const meta = widget.meta(TestMeta);
			const instanceData = widgetInstanceMap.get(widget)!;
			instanceData.nodeHandler.add(element, key);
			assert.isTrue(meta.has(key));
			assert.strictEqual(meta.get(key), element);
		});

		it('elements are added to node handler on update', () => {
			const element = {} as Element;
			const key = '1';
			const widget = new BaseTestWidget();
			const meta = widget.meta(TestMeta);
			const instanceData = widgetInstanceMap.get(widget)!;
			instanceData.nodeHandler.add(element, key);
			assert.isTrue(meta.has(key));
			assert.strictEqual(meta.get(key), element);
		});

		it('root added to node handler on widget create', () => {
			const widget = new BaseTestWidget();
			const meta = widget.meta(TestMeta);
			const instanceData = widgetInstanceMap.get(widget)!;

			instanceData.nodeHandler.addRoot();
			assert.isTrue(meta.widgetEvent);
		});

		it('root added to node handler on widget update', () => {
			const widget = new BaseTestWidget();
			const meta = widget.meta(TestMeta);
			const instanceData = widgetInstanceMap.get(widget)!;

			instanceData.nodeHandler.addRoot();
			assert.isTrue(meta.widgetEvent);
		});

		it('Meta is destroyed when the widget is detached', () => {
			let metaDestroyed = false;
			class DestroyableMeta extends TestMeta {
				destroy() {
					const result = super.destroy();
					metaDestroyed = true;
					return result;
				}
			}
			const widget = new BaseTestWidget();
			widget.meta(DestroyableMeta);
			const instanceData = widgetInstanceMap.get(widget)!;
			instanceData.onDetach();
			assert.isTrue(metaDestroyed);
		});
	});

	describe('decorators', () => {
		it('returns an empty array for decorators that do not exist', () => {
			@testDecorator()
			class TestWidget extends BaseTestWidget {}
			const widget = new TestWidget();
			const decorators = widget.callGetDecorator('unknown-decorator');
			assert.lengthOf(decorators, 0);
		});

		it('decorators are cached', () => {
			@testDecorator()
			class TestWidget extends BaseTestWidget {}

			const widget = new TestWidget();
			const decorators = widget.callGetDecorator('test-decorator');
			assert.lengthOf(decorators, 1);
			const cachedDecorators = widget.callGetDecorator('test-decorator');
			assert.lengthOf(cachedDecorators, 1);
			assert.strictEqual(cachedDecorators, decorators);
		});

		it('should run meta after renders even when a widget has afterRender decorator', () => {
			let metaAfterRenderCalled = false;
			class MetaWithAfterRender extends TestMeta {
				afterRender() {
					metaAfterRenderCalled = true;
				}
			}

			class TestWidget extends WidgetBase {
				@afterRender()
				protected afterRenders() {}

				protected render() {
					this.meta(MetaWithAfterRender).get('');
					return null;
				}
			}

			const widget = new TestWidget();
			widget.__render__();
			assert.isTrue(metaAfterRenderCalled);
		});

		it('decorators applied to subclasses are not applied to base classes', () => {
			@testDecorator()
			class TestWidget extends BaseTestWidget {}
			@testDecorator()
			@testDecorator()
			class TestWidget2 extends TestWidget {}

			const baseWidget = new TestWidget();
			const widget = new TestWidget2();

			assert.equal(baseWidget.callGetDecorator('test-decorator').length, 1);
			assert.equal(widget.callGetDecorator('test-decorator').length, 3);
		});

		it('decorator cache is populated when addDecorator is called after instantiation', () => {
			class TestWidget extends BaseTestWidget {
				constructor() {
					super();
					this.addDecorator('test-decorator-one', function() {});
					this.addDecorator('test-decorator-two', function() {});
				}
			}

			const testWidget = new TestWidget();

			assert.lengthOf(testWidget.callGetDecorator('test-decorator-one'), 1);
			assert.lengthOf(testWidget.callGetDecorator('test-decorator-two'), 1);
		});

		it('addDecorator accepts an array of decorators', () => {
			class TestWidget extends BaseTestWidget {
				constructor() {
					super();
					this.addDecorator('test-decorator', [() => {}, () => {}]);
				}
			}

			const testWidget = new TestWidget();

			assert.lengthOf(testWidget.callGetDecorator('test-decorator'), 2);
		});
	});
});
