from pdfminer.high_level import extract_text
import os,sys,nltk,time,json
import tiktoken
from doc_provenance import data_digestion
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import pandas as pd
from openai import OpenAI
client = OpenAI()
embedding_model = "text-embedding-3-small"
from collections import deque

nltk.download("punkt")

current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)
sys.path.append(current_file_directory)
from model import model #[gpt4o, gpt4vision, gpt4omini]
model_name = 'gpt4omini'

def extract_text_from_pdf(pdf_path):
    return extract_text(pdf_path)

def merge_short_sentences(sentences, length = 30):
    merged = []
    i = 0
    n = len(sentences)
    
    while i < n:
        current = sentences[i]
        
        # If the sentence isn't short, just push it into merged
        if len(current) >= length:
            merged.append(current)
            i += 1
        
        else:
            # current sentence is short
            # Case A: If merged is empty and there's at least one more sentence, merge forward
            if not merged and i < n - 1:
                # Merge with the next sentence in the original list
                sentences[i + 1] = current + " " + sentences[i + 1]
                i += 1  # We skip adding current to merged
            # Case B: If it's the last sentence or there's no next to merge with
            elif i == n - 1:
                # If there's something in merged, merge with the last item in merged
                if merged:
                    merged[-1] = merged[-1] + " " + current
                else:
                    # Edge case: only one short sentence in the entire list
                    merged.append(current)
                i += 1
            else:
                # We have both a previous (in merged) and a next (in sentences)
                previous = merged[-1] if merged else ""  # Should not be empty logically here
                next_sent = sentences[i + 1]
                
                if len(previous) <= len(next_sent):
                    # Merge short sentence with previous
                    merged[-1] = previous + " " + current
                    i += 1
                else:
                    # Merge short sentence with next
                    sentences[i + 1] = current + " " + next_sent
                    i += 1
                # Notice we do not add `current` to `merged` because it was merged away

    return merged


def extract_sentences_from_pdf(text):
    sentences = nltk.sent_tokenize(text)
    sentences = merge_short_sentences(sentences)
    return sentences

def write_list_to_file(filename, lines):
    with open(filename, "w", encoding="utf-8") as file:
        file.writelines(f"{line}\n" for line in lines)

def write_string_to_file(filename, text):
    with open(filename, "w", encoding="utf-8") as file:
        file.write(text)

def write_json_to_file(filename, data):
    if len(filename) == 0:
        print(filename,'not exist!')
        return 
    with open(filename, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)

def create_data_folder(path):
    data_path = path.replace('data','out').replace('.pdf','')
    os.makedirs(data_path, exist_ok=True)
    return data_path

def count_tokens(text, model="gpt-4o-mini"):
    encoder = tiktoken.encoding_for_model(model)  # Get the tokenizer for the specific model
    tokens = encoder.encode(text)  # Encode text into tokens
    return len(tokens)


def QA(question, context):
    #intruction = ' If answers are not found, return NULL.'
    print(len(context))
    if len(context) == 0:
        return ['NULL'], 0, 0
    prompt = (question[0] + question[1], context)
    response = model(model_name, prompt)
    print('Prompt is:', prompt[0])
    print('QA response is:', response)
    if('|' in response):
        ans = [o.strip() for o in response.split('|')]
    else:
        ans = [response.strip()]
    input_tokens = count_tokens(question[0] + question[1] + context)
    output_tokens = count_tokens(response)
    return ans, input_tokens, output_tokens


def eval_equivelance_rules(s):
    if 'Kriiger' in s:
        s = s.replace('Kriiger','Krüger')
    s = s.strip('.')
    return s

def equal_string(res1, res2):
    if(len(res1) != len(res2)):
        return False
    res1_lower = []
    for r in res1:
        if 'null' in r.lower():
            return False
    for r in res2:
        if 'null' in r.lower():
            return False
    # print('before:',res1)
    # print('before:',res2)
    for r in res1:
        res1_lower.append(eval_equivelance_rules(r).lower())
        
    res2_lower = []
    for r in res2:
        res2_lower.append(eval_equivelance_rules(r).lower())
    # print('after:',res1_lower)
    # print('after:',res2_lower)
    for r in res1_lower:
        if r not in res2_lower:
            return False
    for r in res2_lower:
        if r not in res1_lower:
            return False
    return True

def equal(res1, res2, metric = 'string'):
    res1 = sorted(res1)
    res2 = sorted(res2)
    #print(len(res1), len(res2))
    #res1 and res2 are both list of strings 
    if(metric == 'string'):
        return equal_string(res1, res2)
    else:
        instruct_prompt = 'Determine if two strings are equivalent in meaning, not just in format. Lists must contain the same elements, allowing for alternative spellings, transliterations, or equivalent name variations. Missing or extra elements make them unequal. Dates in different formats should be considered equivalent if they represent the same time. Ignore case, punctuation, and spacing unless they change meaning. Return True if the strings are equivalent and False otherwise. Do not add explanations. ' 
        if equal_string(res1, res2):
            return True
        if len(res1) != len(res2):
            return False 
        if(len(res1) > 1 or len(res2) > 1):
            print('LLM evaluation1')
            instruction = instruct_prompt + ' String 1 is: ' + " ".join(res1) + ' String 2 is: ' + " ".join(res2)
            response = model(model_name, (instruction, ''))
            if('true' in response.lower()):
                return True
            return False
        if(len(res1) == 1 and len(res2) == 1):
            str1 = res1[0]
            str2 = res2[0]
            if len(str1) > 2*len(str2) or len(str2) > 2*len(str1):
                print('length mis-match')
                return False
            print('LLM evaluation2')
            instruction = 'Given the following two strings, String 1 is: '  + res1[0] + '. String 2 is: ' + res2[0] + '. ' + instruct_prompt
            response = model(model_name, (instruction, ''))
            #print(instruction)
            if('true' in response.lower()):
                return True
            return False

def evaluate(answers, question, ids, sentences, context = '', metric = 'string'):
    ids = sorted(ids)
    if(context == ''):
        for id in ids:
            context += sentences[id]
    pred_ans, input_tokens, output_tokens = QA(question, context)
    #print(pred_ans, len(context), question)
    if(equal(pred_ans, answers, metric)):
        #print('True')
        return True, input_tokens, output_tokens
    else:
        #print('False')
        return False, input_tokens, output_tokens

def LLM_vanilla(question, context, title, path):
    answers, input_tokens, output_tokens = QA(question,context)
    print(answers)

    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    out['context_size'] = count_tokens(context)
    
    st = time.time()
    """
        Directly invoke LLM to return the provenance of ``answers'' to ``question'' in a given ``context''
    """
    instruction = 'Given the following question: ' + question[0] + ', the corresponding answers are: ' + ','.join(answers) +  '. Your task is to extract the set of sentences from the provided context that contribute to generating these answers. Identify the most relevant sentences that support the given answers. Make sure these sentences are raw sentences from the document. Do not add explanations. Do not create new words or sentences. The context is as follows: '
    prompt = (instruction, context)
    response = model(model_name, prompt)
    et = time.time()
    out['time'] = et-st
    out['provenance'] = response
    out['provenance_size'] = count_tokens(response)
    input_tokens = count_tokens(instruction + context)
    output_tokens = count_tokens(response)
    out['tokens'] = (input_tokens, output_tokens)
    write_json_to_file(path, out)
    return out

def sequential_greedy(question, context, title, path, metric = 'string'):
    st = time.time()
    answers = QA(question, context)
    sentences = extract_sentences_from_pdf(context)
    out = sequential_greedy_core(question, answers, sentences, title, metric = metric)
    et = time.time()
    out['time'] = et-st
    out['path'] = path
    out['context_size'] = count_tokens(context)
    write_json_to_file(path, out)

    return out 

def enumerate_skip_ids(cur_ids):
    new_len = len(cur_ids) * 2
    new_ids = []
    st_id = cur_ids[len(cur_ids)-1] + 1
    for i in range(new_len):
        new_ids.append(st_id)
        st_id += 1
    return new_ids

def exponential_greedy_core(question, answers, sentences, sorted_idx = [], metric = 'string'):
    out = {}
    out['question'] = question
    out['answers'] = answers
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0

    if len(sorted_idx) == 0:
        sorted_idx = list(range(len(sentences)))

    #print(sorted_idx)

    skip_ids = []
    skip_ids.append(sorted_idx[0])
    i = 0

    while True:#iterate sentences stored in skip_ids to check if delete
        if skip_ids[0] > sorted_idx[len(sorted_idx)-1]:
            break
        remaining_sentences_id = []

        for i in sorted_idx:#get remaining sentences for evaluation
            if i in skip_ids:
                continue
            if i in removed_sentences:
                continue
            remaining_sentences_id.append(i)

        sorted_remaining_sentences_id = sorted(remaining_sentences_id)
        #print(sorted_remaining_sentences_id)
        
        eval_result, input_token, output_token = evaluate(answers, question, sorted_remaining_sentences_id, sentences, metric = metric)
        input_tokens += input_token
        output_tokens += output_token

        #print(skip_ids, eval_result)

        if eval_result == True:#if removing this sentence does not change the final answers, then these sentences can be removed 
            removed_sentences += skip_ids
            #get an exponential large skip_ids
            skip_ids = enumerate_skip_ids(skip_ids)
        else: #sentences in current skip ids cannot be removed 
            if len(skip_ids) == 1: #if an unit sentence cannot be removed, iterate the next sentence 
                skip_ids = [skip_ids[0] + 1]
            else:
                skip_ids = [skip_ids[0]] #reset to be the start of current skip ids, with initial step 


    provenance = []
    provenance_id = []
    for i in range(len(sentences)):
        if i in removed_sentences:
            continue
        provenance_id.append(i)
        provenance.append(sentences[i])

    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = provenance_id  

    return out 

def raw_exponential_greedy(question, text, title, result_path, metric = 'string'):
    answers, input_tokens, output_tokens = QA(question,text)
    sentences = extract_sentences_from_pdf(text)
    #print(len(sentences))
    st = time.time()
    out['title'] = title
    out['context_size'] = count_tokens(text)
    out = exponential_greedy_core(question, answers, sentences, metric = metric)
    et = time.time()
    out['time'] = et-st
    write_json_to_file(result_path, out)
    return out 



def sequential_greedy_core(question, answers, sentences, title, sorted_idx = [], metric = 'string'):
    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    
    #print('Number of sentences:', len(sentences)) 
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0

    #print(len(sentences))
    if len(sorted_idx) == 0:
        sorted_idx = list(range(len(sentences)))

    #print(sorted_idx)

    for i in sorted_idx:
        #print('Iterating sentence ',i, len(sorted_idx))
        #print(sentences[i])
        remaining_sentences_id = []
        for j in sorted_idx:
            if j in removed_sentences:
                continue
            if i == j:
                continue
            remaining_sentences_id.append(j)

        sorted_remaining_sentences_id = sorted(remaining_sentences_id)
        
        eval_result, input_token, output_token = evaluate(answers, question, sorted_remaining_sentences_id, sentences, metric = metric)
        input_tokens += input_token
        output_tokens += output_token
        if eval_result == True:#if removing this sentence does not change the final answers, then this sentence can be removed 
            removed_sentences.append(i) 
            #print('Sentence ',i, ' is removed!')
    provenance = []
    provenance_id = []
    for i in sorted_idx:
        if i in removed_sentences:
            continue
        provenance_id.append(i)
        provenance.append(sentences[i])

    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = provenance_id 

    return out 

binary_out_ids = []
sum_input_tokens = 0
sum_output_tokens = 0

def block_labeler(sentences, question, answers, blk_num):
    blocks = []
    blocks_sentences_id = []
    block_size = len(sentences)/blk_num
    bid = 0
    block = []
    ids = []
    #print(block_size)
    for i in range(len(sentences)):
        block.append(sentences[i])
        ids.append(i)
        bid += 1
        if(bid > block_size):
            bid = 0
            block_content = ''.join(block)
            blocks.append(block_content)
            blocks_sentences_id.append(ids)
            ids = []
            block = []
        else:
            if i == len(sentences) - 1:
                # add last block
                block_content = ''.join(block)
                blocks.append(block_content)
                blocks_sentences_id.append(ids)
    instruction = 'Given the following question: ' + question[0] + ' and a list of text blocks, the corresponding answers are: ' + ','.join(answers) +  '. Your task is to assign a score (from 1 to 10) to each block based on how likely it is to contain context relevant to answering the question. The text blocks are listed below, each starting with Block i: followed by its content. Return only a comma-separated list of scores corresponding to each block, in the order they are given. Do not include any explanations or additional text. '
    context = ''
    #print(len(blocks))
    for id in range(len(blocks)):
        context += 'Block ' + str(id) + ': ' + blocks[id] + '\n'
    prompt = (instruction, context)
    print(count_tokens(context))
    response = model(model_name, prompt)
    #print(response)
    scores = [int(num.strip()) for num in response.split(",")]
    block_scores = {}
    #print(scores)
    #print(len(scores), len(blocks), len(blocks_sentences_id))
    if len(scores) != len(blocks):
        #print('Labeler does not score for each block!') 
        id = 0
        while id < len(blocks):
            if id < len(scores):
                block_scores[id] = scores[id]
            else:
                block_scores[id] = 1
            id += 1
    else:
        #print('Labeler scores for each block!')
        for id in range(len(blocks)):
            block_scores[id] = scores[id]

    return block_scores, blocks_sentences_id



def divide_and_conquer_progressive_API(raw_question, text, result_path, k=5, stop_sentence_length = 5,  metric = 'string'):
    global binary_out_ids,sum_input_tokens,sum_output_tokens
    sum_input_tokens = 0
    sum_output_tokens = 0
    binary_out_ids = []
    instruction = 'Only return the answer. Do not add explanations. '
    question = (raw_question, instruction)
    answers, input_tokens, output_tokens = QA(question,text)
    print('Answers:',answers)
    sentences = extract_sentences_from_pdf(text)
    answer_path = result_path + '/answers.txt'
    #print(answers)
    write_string_to_file(answer_path, ''.join(answers))
    blk_num = len(sentences)/k
    blk_num = min(20, blk_num)
    #print(blk_num, len(sentences))
    block_scores, blocks_sentences_id = block_labeler(sentences, question, answers, blk_num)

    for id, score in block_scores.items():
        print(score)

    ids = []
    for i in range(len(sentences)):
        ids.append(i)
    
    provenance_path = result_path + '/provenance.json'
    divide_and_conquer_iterative_with_cache_progressive(answers, question, ids, sentences, block_scores, blocks_sentences_id, k, stop_sentence_length, metric = metric, result_path = provenance_path)

def divide_and_conquer_progressive(question, text, title, path, k, stop_sentence_length = 5,  metric = 'string'):
    #k: the length of sentnces in the interval to stop iteration, k can be decided based on the cost of divide_and_conquer and greedy on last mile, in different scenarios  
    global binary_out_ids,sum_input_tokens,sum_output_tokens
    sum_input_tokens = 0
    sum_output_tokens = 0
    binary_out_ids = []
    
    answers, input_tokens, output_tokens = QA(question,text)
    sentences = extract_sentences_from_pdf(text)
    print(answers, len(text), question)
    blk_num = len(sentences)/k
    blk_num = min(20, blk_num)
    print(blk_num, len(sentences))
    block_scores, blocks_sentences_id = block_labeler(sentences, question, answers, blk_num)


    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    out['context_size'] = count_tokens(text)

    ids = []
    
    for i in range(len(sentences)):
        ids.append(i)
    st = time.time()

    break_down_latency, break_down_cost, break_down_provenance_ids = divide_and_conquer_iterative_with_cache_progressive(answers, question, ids, sentences, block_scores, blocks_sentences_id, k, stop_sentence_length, metric)
    et = time.time()
    out['time'] = et-st
    out['time_breakdown'] = break_down_latency

    out['tokens'] = (sum_input_tokens, sum_output_tokens)
    out['tokens_breakdown'] = break_down_cost

    out['provenance_ids_breakdown'] = break_down_provenance_ids 
    write_json_to_file(path, out)

def block_decider(left_ids, right_ids, block_scores, blocks_sentences_id):
    # print(left_ids)
    # print(right_ids)
    # for block_id, score in block_scores.items():
    #     print(blocks_sentences_id[block_id], score)
    # find the set of blocks overlapping with left_ids and right_ids
    left_ids_left = left_ids[0]
    left_ids_right = left_ids[len(left_ids)-1]

    right_ids_left = right_ids[0]
    right_ids_right = right_ids[len(right_ids)-1]

    left_blocks = []
    right_blocks = []

    left_block_start = 0
    left_block_end = 0
    right_block_start = 0
    right_block_end = 0

    for i in range(len(blocks_sentences_id)):
        block_ids = blocks_sentences_id[i]
        if left_ids_left in block_ids:
            left_block_start = i
        if left_ids_right in block_ids: 
            left_block_end = i
        if right_ids_left in block_ids:
            right_block_start = i
        if right_ids_right in block_ids:
            right_block_end = i
    
    # print(left_block_start, left_block_end)
    # print(right_block_start, right_block_end)
    left_score = 0
    right_score = 0

    for i, score in block_scores.items():
        if i >= left_block_start and i <= left_block_end:
            left_score += score
        if i >= right_block_start and i <= right_block_end:
            right_score += score
    
    left_score /= (left_block_end - left_block_start + 1)
    right_score /= (right_block_end - right_block_start + 1)

    #print(left_score, right_score)

    if left_score > right_score:
        return left_ids
    
    return right_ids

provenance_topk_results = []
topk_provenance_id = 0

def store_provenance():
    a=0

def divide_and_conquer_iterative_with_cache_progressive(answers, question, ids, sentences, block_scores, blocks_sentences_id, k, stop_sentence_length, metric = 'string', result_path = ''):
    """
    Attempt to find a smaller subset of `sentences` that returns True for H,
    using a divide-and-conquer approach but in a non-recursive (queue-based) way.
    Adds a caching mechanism to avoid re-evaluating the same subsets.
    
    Returns:
        True if the entire input `ids` subset is True under `evaluate`,
        False otherwise.
    
    Side-effects:
        - Appends to the global list `binary_out_ids` those IDs that
          we deem necessary.
        - Accumulates token usage in `sum_input_tokens` and `sum_output_tokens`.
    """
    global binary_out_ids, sum_input_tokens, sum_output_tokens, topk_provenance_id, provenance_topk_results

    break_down_latency = {}
    break_down_provenance_ids = {}
    break_down_cost = {}

    father = {}
    rib = {}
    
    # A dictionary to cache evaluation results: { (ids_as_tuple): (eval_result, input_tokens, output_tokens) }
    eval_cache = {}
    st = time.time()
    
    def is_cached(sub_ids):
        """
        A helper function to wrap 'evaluate', storing and retrieving results from 'eval_cache'.
        """
        # Convert the list of IDs to a tuple so it can be used as a dictionary key
        key = tuple(sub_ids)
        
        # Return cached result if we already have it
        if key in eval_cache:
            return eval_cache[key]
        
        return 'NULL'
    
    def set_cached(sub_ids, result):
        key = tuple(sub_ids)
        eval_cache[key] = result 

    # Use a queue to perform an iterative, divide-and-conquer approach
    stack = [ids]

    # current_ids has alredy been runed, set its status 
    #set_cached(ids, True)

    while stack:
        current_ids = stack.pop()
        #print(current_ids)
        if topk_provenance_id >= k:
            continue

        # Evaluate the entire set once, storing the result
        if is_cached(current_ids) == 'NULL':
            eval_result, input_token, output_token = evaluate(answers, question, current_ids, sentences, metric = metric)
            sum_input_tokens += input_token
            sum_output_tokens += output_token
            set_cached(current_ids, eval_result)
        else:
            eval_result = is_cached(current_ids)

        #print(current_ids, eval_result)
        # If the entire set doesn't yield True, no need to proceed

        tuple_current_ids = tuple(current_ids)
        if not eval_result:
            if tuple_current_ids in rib and tuple_current_ids in father:
                rib_node = rib[tuple_current_ids]
                father_node = father[tuple_current_ids]
                #print(father_node, tuple_current_ids, rib_node)
                eval_rib = is_cached(list(rib_node))
                if eval_rib == 'NULL':
                    continue
                if not eval_rib:
                    #in this case, father node is true, but both childs are false, add father node into last_mile operator
                    #print('Starting exponential_greedy_core...')
                    out = exponential_greedy_core(question, answers, sentences, sorted_idx = list(father_node))
                    provenance_ids = out['provenance_ids']
                    print('Top-'+ str(topk_provenance_id),' provenance:',provenance_ids)
                    provenance_context = ''
                    for id in provenance_ids:
                        provenance_context += sentences[id]
                    print('Provenance:', provenance_context)
                    print('Input tokens:', sum_input_tokens)
                    print('Output tokens:', sum_output_tokens)
                    print('Time:', time.time() - st)

                    break_down_latency[topk_provenance_id] = time.time()-st
                    break_down_cost[topk_provenance_id] = (sum_input_tokens,sum_output_tokens)
                    break_down_provenance_ids[topk_provenance_id] = provenance_ids

                    provenance_object = {}
                    provenance_object['provenance_id'] = topk_provenance_id
                    provenance_object['sentences_ids'] = provenance_ids
                    provenance_object['time'] = time.time() - st
                    provenance_object['input_token_size'] = sum_input_tokens
                    provenance_object['output_token_size'] = sum_output_tokens
                    provenance_topk_results.append(provenance_object)

                    write_json_to_file(result_path, provenance_topk_results)
                    topk_provenance_id += 1
                    
            continue
        if eval_result and len(current_ids) <= stop_sentence_length: #k is the length of sentences in the interval to stop iteration 
            # send current ids to another operator to produce MP 
            out = sequential_greedy_core(question, answers, sentences, '', sorted_idx = current_ids)

            provenance_ids = out['provenance_ids']
            print('Top-'+ str(topk_provenance_id),' provenance:',provenance_ids)
            provenance_context = ''
            for id in provenance_ids:
                provenance_context += sentences[id]
            print('Provenance:', provenance_context)
            print('Input tokens:', sum_input_tokens)
            print('Output tokens:', sum_output_tokens)
            print('Time:', time.time() - st)

            break_down_latency[topk_provenance_id] = time.time()-st
            break_down_cost[topk_provenance_id] = (sum_input_tokens,sum_output_tokens)
            break_down_provenance_ids[topk_provenance_id] = provenance_ids

            provenance_object = {}
            provenance_object['provenance_id'] = topk_provenance_id
            provenance_object['sentences_ids'] = provenance_ids
            provenance_object['time'] = time.time() - st
            provenance_object['input_token_size'] = sum_input_tokens
            provenance_object['output_token_size'] = sum_output_tokens
            provenance_topk_results.append(provenance_object)

            write_json_to_file(result_path, provenance_topk_results)
            topk_provenance_id += 1
            continue

        # Split the current subset into two halves
        mid = len(current_ids) // 2
        left = current_ids[:mid]
        right = current_ids[mid:]
        ids_togo = block_decider(left, right, block_scores, blocks_sentences_id)
        #continue

        tuple_left = tuple(left)
        tuple_right = tuple(right)

        father[tuple_left] = tuple_current_ids
        father[tuple_right] = tuple_current_ids
        rib[tuple_left] = tuple_right
        rib[tuple_right] = tuple_left

        if ids_togo == left: #last in, first out 
            if is_cached(right) == 'NULL':
                stack.append(right)
            if is_cached(left) == 'NULL':
                stack.append(left) 
        else:
            if is_cached(left) == 'NULL':
                stack.append(left)
            if is_cached(right) == 'NULL':
                stack.append(right)

    return break_down_latency, break_down_cost, break_down_provenance_ids
            
        

def divide_and_conquer(question, text, title, path,metric = 'string'):
    global binary_out_ids,sum_input_tokens,sum_output_tokens
    sum_input_tokens = 0
    sum_output_tokens = 0
    binary_out_ids = []
    answers, input_tokens, output_tokens = QA(question,text)
    print(answers)

    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    out['context_size'] = count_tokens(text)

    st = time.time()
    ids = []
    sentences = extract_sentences_from_pdf(text)
    for i in range(len(sentences)):
        ids.append(i)
    divide_and_conquer_iterative_with_cache(answers, question, ids, sentences, metric)
    binary_out_ids = list(set(binary_out_ids))
    binary_out_ids = sorted(binary_out_ids)
    #print(binary_out_ids)
    et = time.time()
    out['time'] = et-st
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = binary_out_ids 
    provenance = []
    for id in binary_out_ids:
        provenance.append(sentences[id])
    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    write_json_to_file(path, out)




def divide_and_conquer_iterative_with_cache(answers, question, ids, sentences, metric = 'string'):
    """
    Attempt to find a smaller subset of `sentences` that returns True for H,
    using a divide-and-conquer approach but in a non-recursive (queue-based) way.
    Adds a caching mechanism to avoid re-evaluating the same subsets.
    
    Returns:
        True if the entire input `ids` subset is True under `evaluate`,
        False otherwise.
    
    Side-effects:
        - Appends to the global list `binary_out_ids` those IDs that
          we deem necessary.
        - Accumulates token usage in `sum_input_tokens` and `sum_output_tokens`.
    """
    global binary_out_ids, sum_input_tokens, sum_output_tokens
    
    # A dictionary to cache evaluation results: { (ids_as_tuple): (eval_result, input_tokens, output_tokens) }
    eval_cache = {}
    
    def is_cached(sub_ids):
        """
        A helper function to wrap 'evaluate', storing and retrieving results from 'eval_cache'.
        """
        # Convert the list of IDs to a tuple so it can be used as a dictionary key
        key = tuple(sub_ids)
        
        # Return cached result if we already have it
        if key in eval_cache:
            return eval_cache[key]
        
        return 'NULL'
    
    def set_cached(sub_ids, result):
        key = tuple(sub_ids)
        eval_cache[key] = result 

    # Use a queue to perform an iterative, divide-and-conquer approach
    queue = deque()
    queue.append(ids)

    while queue:
        current_ids = queue.popleft()

        # Evaluate the entire set once, storing the result
        if is_cached(current_ids) == 'NULL':
            eval_result, input_token, output_token = evaluate(answers, question, current_ids, sentences, metric)
            sum_input_tokens += input_token
            sum_output_tokens += output_token
            set_cached(current_ids, eval_result)
        else:
            eval_result = is_cached(current_ids)

        print(current_ids, eval_result)
        # If the entire set doesn't yield True, no need to proceed
        if not eval_result:
            continue
        if eval_result and len(current_ids) <= 1:
            binary_out_ids += current_ids
            continue

        # Split the current subset into two halves
        mid = len(current_ids) // 2
        left = current_ids[:mid]
        right = current_ids[mid:]

        # Evaluate left and right subsets (using cache)
        if is_cached(left) == 'NULL':
            eval_result_left, input_token_left, output_token_left = evaluate(answers, question, left, sentences, metric)
            sum_input_tokens += input_token_left
            sum_output_tokens += output_token_left
            set_cached(left, eval_result_left)
        else:
            eval_result_left = is_cached(left)

        if is_cached(right) == 'NULL':
            eval_result_right, input_token_right, output_token_right = evaluate(answers, question, right, sentences, metric)
            sum_input_tokens += input_token_right
            sum_output_tokens += output_token_right
            set_cached(right, eval_result_right)
        else:
            eval_result_right = is_cached(right)

        # If both halves fail individually (False) but the entire set was True,
        # we consider the whole subset as necessary and skip further splitting
        if (not eval_result_left) and (not eval_result_right) and eval_result:
            binary_out_ids += current_ids
            continue
        
        if(eval_result_left):
            queue.append(left)
        if(eval_result_right):
            queue.append(right)

def cosine_sim(vec1, vec2):
    return cosine_similarity([vec1], [vec2])[0][0]

def get_embedding(text, model=embedding_model):
    text = text.replace("\n", " ")
    return client.embeddings.create(input = [text], model=model).data[0].embedding

def save_embeddings(filename, embeddings):
    # Extract the directory from the filename
    directory = os.path.dirname(filename)
    
    # Check if the directory exists; if not, create it
    if directory and not os.path.exists(directory):
        os.makedirs(directory)
    
    # Save the embeddings to the specified file
    np.save(filename, embeddings)

def load_embeddings(filename):
    return np.load(filename, allow_pickle=True).item()


def group_sentences(sentences, k = 5):
    #merge k sentneces into a group
    merged_sentences = []
    i = 1
    group_sentence = []
    id = 0
    for sentence in sentences:
        #print(i,k)
        if i > k:
            merged_sentences.append(' '.join(group_sentence))
            i = 1
            group_sentence = []
        group_sentence.append(sentence)
        if id == len(sentences)-1: #last set of sentences 
            merged_sentences.append(' '.join(group_sentence))
        i += 1
        id += 1
    return merged_sentences

def compute_embeddings(text, file_path):
    # if os.path.exists(file_path):
    #     print('file exist!')
    #     return 
    sentences = extract_sentences_from_pdf(text)
    sentences = group_sentences(sentences)
    print(len(sentences))
    embeddings = {}
    for sentence in sentences:
        embeddings[sentence] = get_embedding(sentence)
    save_embeddings(file_path, embeddings)

def sort_sentences_by_similarity(question, answers, text, file_path):
    #print(question)
    #print(answers)
    answer_str = ''.join(answers)
    sentences = extract_sentences_from_pdf(text)
    # Get embedding for the question and answers
    
    question_embedding = get_embedding(question[0] + ' ' + answer_str)
    
    exist = False

    try:
        # Load existing embeddings
        embeddings = load_embeddings(file_path)
        exist = True
        #print('load')
    except FileNotFoundError:
        embeddings = {}
    
    # Compute embeddings and similarity scores for each sentence
    similarity_scores = {}
    for sentence in sentences:
        if sentence not in embeddings:
            embeddings[sentence] = get_embedding(sentence)
        sentence_embedding = embeddings[sentence]
        similarity = cosine_sim(question_embedding, sentence_embedding)
        similarity_scores[sentence] = similarity

    # Save updated embeddings
    if not exist:
        save_embeddings(file_path, embeddings)

    # Pair each sentence with its index and similarity score
    indexed_sentences = list(enumerate(sentences))

    # Sort sentences based on similarity scores in descending order
    sorted_indexed_sentences = sorted(indexed_sentences, key=lambda x: similarity_scores[x[1]], reverse=True)

    # Extract the sorted sentences and their original indices
    sorted_sentences = [sentence for index, sentence in sorted_indexed_sentences]
    sorted_indices = [index for index, sentence in sorted_indexed_sentences]

    # Output the sorted sentences and their original indices
    # for idx, sentence in zip(sorted_indices, sorted_sentences):
    #     print(f"Original Index: {idx}, Sentence: '{sentence}', similarity: '{similarity_scores[sentence]}'")

    # for idx in sorted_indices[:20]:
    #     print(idx, sentences[idx], similarity_scores[sentences[idx]])

    return sorted_indices, similarity_scores

def pick_k_binary(question, text, sorted_indices, metric = 'LLM'):
    answers, input_tokens, output_tokens = QA(question,text)
    #print(answers)
    sentences = extract_sentences_from_pdf(text)
    queue = deque()
    queue.append(len(sorted_indices))
    last_k = len(sorted_indices)
    sum_input_tokens = 0
    sum_output_tokens = 0

    while queue:
        current_k = int(queue.popleft())
        #print(sorted_indices[:current_k])
        eval_result, input_tokens, output_tokens = evaluate(answers, question, sorted_indices[:current_k], sentences, context = '', metric = metric)
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            mid = current_k / 2
            queue.append(mid)
            last_k = current_k
            if current_k <= 1:
                return last_k, sum_input_tokens, sum_output_tokens
        else:
            return last_k, sum_input_tokens, sum_output_tokens
            
    return last_k, sum_input_tokens, sum_output_tokens

def heuristic_topk(question, text, title, result_path, embedding_path, metric = 'LLM'):
    # print(embedding_path)
    # print(result_path)
    answers, in_tokens, out_tokens = QA(question, text)
    out = {}
    st = time.time() 
    sorted_indices, similarity_scores = sort_sentences_by_similarity(question, answers, text, embedding_path)
    k, input_tokens, output_tokens = pick_k_binary(question, text, sorted_indices, metric = metric)
    #print(sorted_indices)
    et = time.time()
    out['time'] = et-st
    out['k'] = k 
    out['tokens'] = (input_tokens, output_tokens)
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['context_size'] = count_tokens(text)

    provenance_ids = sorted_indices[:k]
    provenance = []
    sentences = extract_sentences_from_pdf(text)
    print(k,len(sentences))

    for id in provenance_ids:
        provenance.append(sentences[id])

    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    out['provenance_ids'] = provenance_ids 

    write_json_to_file(result_path, out)
    return out


    

def heuristic_greedy(question, text, title, result_path, embedding_path, metric = 'string'):
    print(embedding_path)
    print(result_path)
    answers = QA(question, text)
    st = time.time()
    sorted_indices, similarity_scores = sort_sentences_by_similarity(question, answers, text, embedding_path)
    k, extra_input_tokens, extra_output_tokens = pick_k_binary(question, text, sorted_indices, metric = metric)
    #print(k, len(sorted_indices))
    sentences = extract_sentences_from_pdf(text)
    out = sequential_greedy_core(question, answers, sentences, title, sorted_idx = sorted_indices[:k])
    et = time.time()
    out['time'] = et-st
    out['k'] = k 
    out['context_size'] = count_tokens(text)
    (input_tokens, output_tokens) = out['tokens']
    out['tokens'] = (input_tokens + extra_input_tokens, output_tokens + extra_output_tokens)

    write_json_to_file(result_path, out)
    return out



def read_json(path):
    with open(path, "r", encoding="utf-8") as file:
        data = json.load(file)
    return data

def verification(metric='string'):
    data_path = parent_directory + '/out/papers/results/'
    strategies = ['vallina_LLM','sequential_greedy','divide_and_conquer','heuristic_greedy']

    doc_num = 4
    q_num = 3
    runs = {}
    for d_id in range(doc_num):
        for q_id in range(q_num):
            #this is one run 
            for strategy in strategies:
                file_path = data_path + 'doc' + str(d_id) + '_q' + str(q_id) + '_' + strategy + '.json'
                result = read_json(file_path)
                if strategy not in runs:
                    runs[strategy] = []
                runs[strategy].append(result) 

    for strategy in strategies:
        accuracy = 0
        if strategy == 'vallina_LLM':
            for o in runs[strategy]:
                print(o['path'])
                answers = o['answers']
                if isinstance(o['provenance'], list):
                    provenance = "".join(o['provenance'])
                else:
                    provenance = o['provenance']
                question = o['question']
                print(answers, question)
                eval, in_tokens, out_tokens = evaluate(answers, question, [],[], context=provenance, metric='string')
                

        #print(strategy, accuracy, len(runs[strategy]))

def test_paper_pipeline():
    data_path = parent_directory + '/data/papers.json'
    folder_path = parent_directory + '/out/papers'
    paper_objects = data_digestion.digest_paper_dataset(data_path)
    sample_paper_questions = data_digestion.sample_paper_questions()

    strategies = ['vallina_LLM','sequential_greedy','divide_and_conquer','heuristic_greedy','heuristic_topk','exponential_greedy','divide_and_conquer_progressive']
    strategy = 'divide_and_conquer_progressive'
    doc_num = 5

    for q_id in range(len(sample_paper_questions)):
        q = sample_paper_questions[q_id]
        for p_id in range(len(paper_objects)):
            paper = paper_objects[p_id]
            path = folder_path + '/results/' + 'doc' + str(p_id) + '_q' + str(q_id) + '_' + strategy + '.json'
            if p_id != 0 or q_id != 0:
                continue
            # if os.path.isfile(path):
            #     continue
            if(p_id >= doc_num):
                break
            text = paper['text']
            title = paper['title']
            print(path)
            print(title,q)
            embedding_path = folder_path + '/embeddings/' + 'doc' + str(p_id) + '_embeddings.npy'
            if strategy == 'vallina_LLM':
                vallina_LLM(q, text, title, path)
            elif strategy == 'sequential_greedy':
                sequential_greedy(q, text, title, path) 
            elif strategy == 'divide_and_conquer': 
                divide_and_conquer(q, text, title, path)
            elif strategy == 'divide_and_conquer_progressive': 
                divide_and_conquer_progressive(q, text, title, path, 5)
            elif strategy == 'heuristic_greedy':
                heuristic_greedy(q, text, title, path, embedding_path) 
            elif strategy == 'heuristic_topk':
                heuristic_topk(q, text, title, path, embedding_path)
            elif strategy == 'exponential_greedy':
                exponential_greedy(q, text, title, path)
    
            #break
        #break

def if_rerun(path):
    df = read_json(path)
    if len(df['time_breakdown']) == 0:
        return False
    return True

def test_hotpot_pipeline():
    data_path = parent_directory + '/data/hotpotQA_fullwiki.json'
    folder_path = parent_directory + '/out/hotpotQA'
    hotpot_objects = data_digestion.digest_hotpotQA_dataset(data_path)

    strategies = ['vallina_LLM','sequential_greedy','divide_and_conquer','heuristic_greedy','heuristic_topk','exponential_greedy','divide_and_conquer_progressive']
    strategy = 'divide_and_conquer_progressive'
    num_of_case = 10

    i = -1
    for e in hotpot_objects:
        i += 1
        question = e['question']
        instruction = e['instruction']
        q = (question, instruction)
        text = e['context']
        title = e['document_name']
        path = folder_path + '/results/' + 'hotpot' + '_q' + str(i) + '_' + strategy + '.json'
        if not os.path.exists(folder_path + '/results'):
            os.makedirs(folder_path + '/results')
        # if if_rerun(path):
        #     continue
        if i != 11:
            continue
        # if os.path.isfile(path):
        #     continue
        print(path)
        embedding_path = folder_path + '/embeddings/' + 'hotpot' + '_q' + str(i) + '_embeddings.npy'
        if strategy == 'vallina_LLM':
            vallina_LLM(q, text, title, path)
        elif strategy == 'sequential_greedy':
            sequential_greedy(q, text, title, path, metric = 'LLM') 
        elif strategy == 'divide_and_conquer': 
            divide_and_conquer(q, text, title, path)
        elif strategy == 'divide_and_conquer_progressive': 
            divide_and_conquer_progressive(q, text, title, path, 5)
        elif strategy == 'heuristic_greedy':
            heuristic_greedy(q, text, title, path, embedding_path) 
        elif strategy == 'heuristic_topk':
            heuristic_topk(q, text, title, path, embedding_path)
        elif strategy == 'exponential_greedy':
            exponential_greedy(q, text, title, path)
        #break
        if(i > num_of_case):
            break

def verify_evaluation_equivelance(text, question):
    out = {}
    answer, in_tokens, out_tokens = QA(question, text)
    instruction = 'Based on the context provided below, if the provided answer is the correct answer to below question, return YES, otherwise, return NO. Do not include any explanations. ' + 'Question: ' + question[0]   + ' Answer: ' +  ''.join(answer) + '. Context: '
    ans, in_tokens, out_tokens = QA((instruction, ''), text)
    out['answer'] = answer
    out['question'] = question
    out['instruction'] = instruction
    out['eval'] = ans 
    # print('question:',question)
    # print('answer:',answer)
    # print('eval:',ans)
    # print('instruction:',instruction)

    return out 


def verify_evaluation_equivelance_pipeline():
    data_path = parent_directory + '/data/hotpotQA_fullwiki.json'
    folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results' + '/eval/hotpotQA'
    hotpot_objects = data_digestion.digest_hotpotQA_dataset(data_path)
    i = 0
    size = 500
    cnt = 0
    #print(len(hotpot_objects))
    for e in hotpot_objects:
        i += 1
        question = e['question']
        instruction = e['instruction']
        q = (question, instruction)
        text = e['context']
        title = e['document_name']
        path = folder_path + '/results/' + 'hotpot' + '_q' + str(i) + '_' + 'equivalence' + '.json'
        if not os.path.exists(folder_path + '/results'):
            os.makedirs(folder_path + '/results')
        out = verify_evaluation_equivelance(text, q)
        out['path'] = path
        out['title'] = title
        write_json_to_file(path, out)
        print(i)
        if 'yes' not in out['eval'][0].lower():
            print(out['eval'])
            cnt += 1
        if i > size:
            break
    print(i, cnt)

if __name__ == "__main__":
    test_paper_pipeline()
    #test_hotpot_pipeline()
    verify_evaluation_equivelance_pipeline()
