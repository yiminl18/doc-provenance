    # left_sub = None
    # right_sub = None
    
    # # Check if the left half alone satisfies H
    # eval_result_left, input_token, output_token = evaluate(answers, question, left, sentences)
    # # Accumulate tokens
    # sum_input_tokens += input_token
    # sum_output_tokens += output_token

    # # Check if the right half alone satisfies H
    # eval_result_right, input_token, output_token = evaluate(answers, question, right, sentences)
    # sum_input_tokens += input_token
    # sum_output_tokens += output_token

    # if (not eval_result_left) and (not eval_result_right):
    #     print('none is true')
    #     binary_out_ids += ids
    #     return ids, sum_input_tokens, sum_output_tokens
    # elif eval_result_left and (not eval_result_right):
    #     print('only left is true')
    #     left_sub, left_in_tokens, left_out_tokens = divide_and_conquer_core(answers, question, left, sentences)
    #     return left_sub, sum_input_tokens + left_in_tokens, sum_output_tokens + left_out_tokens
    # elif (not eval_result_left) and eval_result_right:
    #     print('only right is true')
    #     right_sub, right_in_tokens, right_out_tokens = divide_and_conquer_core(answers, question, right, sentences)
    #     return right_sub, sum_input_tokens + right_in_tokens, sum_output_tokens + right_out_tokens
    # else: #left and right are both true, which won't happen if G is not empty 
    #     print('both is true') #choose left 
    #     left_sub, left_in_tokens, left_out_tokens = divide_and_conquer_core(answers, question, left, sentences)
    #     right_sub, right_in_tokens, right_out_tokens = divide_and_conquer_core(answers, question, right, sentences)
    #     sum_input_tokens += left_in_tokens
    #     sum_input_tokens += right_in_tokens
    #     sum_output_tokens += left_out_tokens
    #     sum_output_tokens += right_out_tokens
    #     if(len(left_sub) <= len(right_sub)):
    #         return left_sub, sum_input_tokens, sum_output_tokens
    #     else:
    #         return right_sub, sum_input_tokens, sum_output_tokens


def divide_and_conquer_core(answers, question, ids, sentences):
    
    """
    Attempt to find a smaller subset of `sentences` that returns True for H,
    using a simple divide-and-conquer approach.
    
    Returns a (not guaranteed fully minimal) subset for which H is still True.
    """
    global binary_out_ids,sum_input_tokens,sum_output_tokens
    # If the entire set somehow doesn't trigger True, nothing to return
    eval_result, input_token, output_token = evaluate(answers, question, ids, sentences)
    # Start accumulating total token usage
    sum_input_tokens += input_token
    sum_output_tokens += output_token
    
    if not eval_result:
        return False 
    else:
        # If there's only 0 or 1 sentence, we can't reduce further
        if len(ids) <= 1:
            binary_out_ids += ids
            return True 
    
    # Split into two halves
    mid = len(ids) // 2
    left = ids[:mid]
    right = ids[mid:]

    left_eval_result, left_input_token, left_output_token = evaluate(answers, question, left, sentences)
    sum_input_tokens += left_input_token
    sum_output_tokens += left_output_token
    right_eval_result, right_input_token, right_output_token = evaluate(answers, question, left, sentences)
    sum_input_tokens += right_input_token
    sum_output_tokens += right_output_token

    if not left_eval_result and not right_eval_result and eval_result:
        binary_out_ids += ids
        return True 
    
    divide_and_conquer_core(answers, question, left, sentences)
    divide_and_conquer_core(answers, question, right, sentences)