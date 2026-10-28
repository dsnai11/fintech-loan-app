import { check, section, finish } from '../lib.mjs';
import { nameMatch, maskAadhaar, ifscShape } from '../../src/services/freeChecks.js';
import { namesCompatible } from '../../src/services/amlService.js';

section('NAME MATCH');
const v = (a, b) => nameMatch(a, b).verdict;
check('the same name in another order matches', v('Rahul Kumar Sharma', 'SHARMA RAHUL KUMAR') === 'match');
check('titles are ignored', v('Shri Rahul Sharma', 'Rahul Sharma') === 'match');
check('a middle name on one side is fine', v('Rahul Sharma', 'Rahul Kumar Sharma') === 'match');
check('a first-name initial matches', v('R Sharma', 'Rahul Sharma') === 'match');
check('close spelling matches (Mohd / Mohammed)', v('Mohammad Imran Khan', 'Mohammed Imran Khan') === 'match');
check('different people do not match', v('Rahul Sharma', 'Amit Verma') === 'mismatch');
check('only a shared surname is not a match', v('Rahul Sharma', 'Priya Sharma') !== 'match');
check('initials alone prove nothing', v('R S', 'Rahul Sharma') !== 'match');
check('a missing name is a mismatch', v('', 'Rahul Sharma') === 'mismatch');
check('the strict check still accepts what it did and now accepts spelling variants', namesCompatible('Rahul Kumar', 'Rahul Kumar Sharma') && namesCompatible('Mohammad Imran', 'Mohammed Imran'));
check('and still refuses different names', !namesCompatible('Rahul Sharma', 'Priya Sharma'));

section('AADHAAR MASKING');
check('a 12-digit number shows only the last 4', maskAadhaar('234567891234') === 'XXXX XXXX 1234' && maskAadhaar('2345 6789 1234') === 'XXXX XXXX 1234');
check('Aadhaar-shaped numbers inside text are masked', maskAadhaar('My number is 2345 6789 1234 ok') === 'My number is XXXX XXXX 1234 ok');

section('IFSC SHAPE');
check('a proper code passes, a bad one does not', ifscShape('HDFC0000238') && !ifscShape('HDFC1000238') && !ifscShape('abc'));
finish();
