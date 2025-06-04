

type anyType = 'txt' | 'col' | 'list';

interface AnyResultBase<T> {
    readonly type: anyType;
    readonly value: T;
    readonly tryConverTo: <V>(res: V) => T; 
}


interface AnyResult extends AnyResultBase<string> {
    readonly type: anyType = 'txt';

}


import changeResultType from '../TypeConverter'

function printRes(res: myResult)
{
    window.logger.debug("myResult:");
    window.logger.debug(" - Type: " + res.type);
    window.logger.debug(" - Result: " + res.result);
}


const someVar: MyResultType<string[]> = {
    type: 'Column',
    result: ['Some String here maybe', 'und so noch eine Teile'],
    isNull: false,
    abort: false,
     __brand: 'myResult'
}

printRes(someVar);


const newType = changeResultType<string>(someVar);
window.logger.debug(typeof newType);
window.logger.debug(newType);
